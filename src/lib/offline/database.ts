import type {
	OfflineComicRecord,
	OfflineOutboxRecord,
	OfflineProgressRecord,
	OfflineStateRecord,
} from "./types";

export const OFFLINE_DATABASE_NAME = "comics-offline";
export const OFFLINE_DATABASE_VERSION = 2;

export const OFFLINE_STORE_NAMES = {
	comics: "comics",
	progress: "progress",
	outbox: "outbox",
	state: "offline-state",
} as const;

export type OfflineStoreName =
	(typeof OFFLINE_STORE_NAMES)[keyof typeof OFFLINE_STORE_NAMES];

let databasePromise: Promise<IDBDatabase> | undefined;
let databaseName = OFFLINE_DATABASE_NAME;

/** The database name currently used by this module instance. */
export function getOfflineDatabaseName(): string {
	return databaseName;
}

/**
 * Points this module instance at an isolated database for browser tests.
 *
 * Production code must use the default name. Tests that run concurrently on
 * the same origin need separate names because IndexedDB connections are shared
 * across browser test files even when their JavaScript realms are isolated.
 */
export async function setOfflineDatabaseNameForTesting(
	name: string,
): Promise<void> {
	if (!name.trim()) throw new Error("Offline database name cannot be empty");
	await closeOfflineDatabase();
	databaseName = name;
}

/** Whether this runtime exposes the browser IndexedDB API. */
export function isOfflineStorageSupported(): boolean {
	return typeof indexedDB !== "undefined";
}

function createV1Stores(database: IDBDatabase): void {
	if (!database.objectStoreNames.contains(OFFLINE_STORE_NAMES.comics)) {
		const comics = database.createObjectStore(OFFLINE_STORE_NAMES.comics, {
			keyPath: "issueId",
		});
		comics.createIndex("seriesId", "seriesId", { unique: false });
		comics.createIndex("cachedAt", "cachedAt", { unique: false });
	}

	if (!database.objectStoreNames.contains(OFFLINE_STORE_NAMES.progress)) {
		const progress = database.createObjectStore(OFFLINE_STORE_NAMES.progress, {
			keyPath: "issueId",
		});
		progress.createIndex("updatedAt", "updatedAt", { unique: false });
	}
}

function createV2Stores(database: IDBDatabase): void {
	if (!database.objectStoreNames.contains(OFFLINE_STORE_NAMES.outbox)) {
		const outbox = database.createObjectStore(OFFLINE_STORE_NAMES.outbox, {
			keyPath: "id",
		});
		outbox.createIndex("kind", "kind", { unique: false });
		outbox.createIndex("createdAt", "createdAt", { unique: false });
		outbox.createIndex("dedupeKey", "dedupeKey", { unique: true });
	}

	if (!database.objectStoreNames.contains(OFFLINE_STORE_NAMES.state)) {
		database.createObjectStore(OFFLINE_STORE_NAMES.state, { keyPath: "key" });
	}
}

function migrateDatabase(database: IDBDatabase, oldVersion: number): void {
	if (oldVersion < 1) createV1Stores(database);
	if (oldVersion < 2) createV2Stores(database);
}

/**
 * Opens the offline database and applies every schema migration up to the
 * current version. Connections close themselves when another tab upgrades it.
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
	if (!isOfflineStorageSupported()) {
		return Promise.reject(new Error("IndexedDB is not available"));
	}
	if (databasePromise) return databasePromise;

	const openingDatabase = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(databaseName, OFFLINE_DATABASE_VERSION);

		request.onupgradeneeded = (event) => {
			migrateDatabase(request.result, event.oldVersion);
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			database.onversionchange = () => {
				database.close();
				databasePromise = undefined;
			};
			resolve(database);
		};
	}).catch((error) => {
		databasePromise = undefined;
		throw error;
	});
	databasePromise = openingDatabase;

	return openingDatabase;
}

/** Close this module's shared connection, primarily before deletion/upgrades. */
export async function closeOfflineDatabase(): Promise<void> {
	const pendingDatabase = databasePromise;
	databasePromise = undefined;
	if (!pendingDatabase) return;

	try {
		(await pendingDatabase).close();
	} catch {
		// A failed open has no live connection to close.
	}
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
	});
}

async function readRecord<T>(
	storeName: OfflineStoreName,
	key: IDBValidKey,
): Promise<T | undefined> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readonly");
	const [result] = await Promise.all([
		requestResult<T | undefined>(transaction.objectStore(storeName).get(key)),
		transactionComplete(transaction),
	]);
	return result;
}

async function readAllRecords<T>(storeName: OfflineStoreName): Promise<T[]> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readonly");
	const [result] = await Promise.all([
		requestResult<T[]>(transaction.objectStore(storeName).getAll()),
		transactionComplete(transaction),
	]);
	return result;
}

async function putRecord<T>(
	storeName: OfflineStoreName,
	record: T,
): Promise<void> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readwrite");
	const completed = transactionComplete(transaction);
	transaction.objectStore(storeName).put(record);
	await completed;
}

async function deleteRecord(
	storeName: OfflineStoreName,
	key: IDBValidKey,
): Promise<void> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readwrite");
	const completed = transactionComplete(transaction);
	transaction.objectStore(storeName).delete(key);
	await completed;
}

async function clearStore(storeName: OfflineStoreName): Promise<void> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readwrite");
	const completed = transactionComplete(transaction);
	transaction.objectStore(storeName).clear();
	await completed;
}

async function countRecords(storeName: OfflineStoreName): Promise<number> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readonly");
	const [result] = await Promise.all([
		requestResult(transaction.objectStore(storeName).count()),
		transactionComplete(transaction),
	]);
	return result;
}

async function readAllFromIndex<T>(
	storeName: OfflineStoreName,
	indexName: string,
	query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readonly");
	const [result] = await Promise.all([
		requestResult<T[]>(
			transaction.objectStore(storeName).index(indexName).getAll(query),
		),
		transactionComplete(transaction),
	]);
	return result;
}

async function putOutboxRecord(record: OfflineOutboxRecord): Promise<void> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(
		OFFLINE_STORE_NAMES.outbox,
		"readwrite",
	);
	const completed = transactionComplete(transaction);
	const store = transaction.objectStore(OFFLINE_STORE_NAMES.outbox);
	const existing = await requestResult<OfflineOutboxRecord | undefined>(
		store.index("dedupeKey").get(record.dedupeKey),
	);
	if (existing && existing.id !== record.id) store.delete(existing.id);
	store.put(record);
	await completed;
}

/** Compare and settle a mutation in one transaction, preserving newer writes. */
async function updateOutboxIfCurrent(
	expected: OfflineOutboxRecord,
	replacement: OfflineOutboxRecord | null,
): Promise<boolean> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(
		OFFLINE_STORE_NAMES.outbox,
		"readwrite",
	);
	const completed = transactionComplete(transaction);
	const store = transaction.objectStore(OFFLINE_STORE_NAMES.outbox);
	const current = await requestResult<OfflineOutboxRecord | undefined>(
		store.index("dedupeKey").get(expected.dedupeKey),
	);
	const matches =
		current?.id === expected.id && current.updatedAt === expected.updatedAt;
	if (matches) {
		if (replacement) store.put(replacement);
		else store.delete(expected.id);
	}
	await completed;
	return matches;
}

export const offlineComics = {
	get: (issueId: string) =>
		readRecord<OfflineComicRecord>(OFFLINE_STORE_NAMES.comics, issueId),
	getAll: () => readAllRecords<OfflineComicRecord>(OFFLINE_STORE_NAMES.comics),
	getBySeries: (seriesId: string) =>
		readAllFromIndex<OfflineComicRecord>(
			OFFLINE_STORE_NAMES.comics,
			"seriesId",
			seriesId,
		),
	put: (record: OfflineComicRecord) =>
		putRecord(OFFLINE_STORE_NAMES.comics, record),
	delete: (issueId: string) =>
		deleteRecord(OFFLINE_STORE_NAMES.comics, issueId),
	clear: () => clearStore(OFFLINE_STORE_NAMES.comics),
	count: () => countRecords(OFFLINE_STORE_NAMES.comics),
};

export const offlineProgress = {
	get: (issueId: string) =>
		readRecord<OfflineProgressRecord>(OFFLINE_STORE_NAMES.progress, issueId),
	getAll: () =>
		readAllRecords<OfflineProgressRecord>(OFFLINE_STORE_NAMES.progress),
	put: (record: OfflineProgressRecord) =>
		putRecord(OFFLINE_STORE_NAMES.progress, record),
	delete: (issueId: string) =>
		deleteRecord(OFFLINE_STORE_NAMES.progress, issueId),
	clear: () => clearStore(OFFLINE_STORE_NAMES.progress),
	count: () => countRecords(OFFLINE_STORE_NAMES.progress),
};

export const offlineOutbox = {
	get: (id: string) =>
		readRecord<OfflineOutboxRecord>(OFFLINE_STORE_NAMES.outbox, id),
	getAll: async () => {
		const records = await readAllRecords<OfflineOutboxRecord>(
			OFFLINE_STORE_NAMES.outbox,
		);
		return records.sort((left, right) =>
			left.createdAt.localeCompare(right.createdAt),
		);
	},
	getByKind: (kind: OfflineOutboxRecord["kind"]) =>
		readAllFromIndex<OfflineOutboxRecord>(
			OFFLINE_STORE_NAMES.outbox,
			"kind",
			kind,
		),
	getByDedupeKey: async (dedupeKey: string) => {
		const database = await openOfflineDatabase();
		const transaction = database.transaction(
			OFFLINE_STORE_NAMES.outbox,
			"readonly",
		);
		const [result] = await Promise.all([
			requestResult<OfflineOutboxRecord | undefined>(
				transaction
					.objectStore(OFFLINE_STORE_NAMES.outbox)
					.index("dedupeKey")
					.get(dedupeKey),
			),
			transactionComplete(transaction),
		]);
		return result;
	},
	/** Add a mutation, replacing an older record with the same dedupe key. */
	put: putOutboxRecord,
	updateIfCurrent: updateOutboxIfCurrent,
	delete: (id: string) => deleteRecord(OFFLINE_STORE_NAMES.outbox, id),
	clear: () => clearStore(OFFLINE_STORE_NAMES.outbox),
	count: () => countRecords(OFFLINE_STORE_NAMES.outbox),
};

export const offlineState = {
	get: async <T = unknown>(key: string): Promise<T | undefined> => {
		const record = await readRecord<OfflineStateRecord<T>>(
			OFFLINE_STORE_NAMES.state,
			key,
		);
		return record?.value;
	},
	getRecord: <T = unknown>(key: string) =>
		readRecord<OfflineStateRecord<T>>(OFFLINE_STORE_NAMES.state, key),
	set: <T>(key: string, value: T, updatedAt = new Date().toISOString()) =>
		putRecord<OfflineStateRecord<T>>(OFFLINE_STORE_NAMES.state, {
			key,
			value,
			updatedAt,
		}),
	delete: (key: string) => deleteRecord(OFFLINE_STORE_NAMES.state, key),
	clear: () => clearStore(OFFLINE_STORE_NAMES.state),
	count: () => countRecords(OFFLINE_STORE_NAMES.state),
};

/**
 * Atomically writes progress and its matching outbox mutation.
 *
 * Keeping these records in one transaction prevents a crash from leaving
 * locally visible progress that can never be synchronized.
 */
export async function queueProgressUpdate(
	progress: OfflineProgressRecord,
	mutation: Extract<OfflineOutboxRecord, { kind: "progress" }>,
): Promise<void> {
	if (progress.issueId !== mutation.payload.issueId) {
		throw new Error("Progress and outbox mutation must target the same issue");
	}

	if (
		progress.currentPage !== mutation.payload.currentPage ||
		progress.updatedAt !== mutation.payload.updatedAt ||
		(progress.totalPages !== undefined &&
			progress.totalPages !== mutation.payload.totalPages)
	) {
		throw new Error("Progress and outbox payload fields must match");
	}

	const database = await openOfflineDatabase();
	const transaction = database.transaction(
		[OFFLINE_STORE_NAMES.progress, OFFLINE_STORE_NAMES.outbox],
		"readwrite",
	);
	const completed = transactionComplete(transaction);
	const outbox = transaction.objectStore(OFFLINE_STORE_NAMES.outbox);
	const existing = await requestResult<OfflineOutboxRecord | undefined>(
		outbox.index("dedupeKey").get(mutation.dedupeKey),
	);
	if (existing && existing.id !== mutation.id) outbox.delete(existing.id);
	try {
		transaction.objectStore(OFFLINE_STORE_NAMES.progress).put(progress);
		outbox.put(mutation);
	} catch (error) {
		transaction.abort();
		await completed.catch(() => undefined);
		throw error;
	}
	await completed;
}
