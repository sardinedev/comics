import type { OfflineComicRecord, OfflineProgressRecord } from "./types";

export const OFFLINE_DATABASE_NAME = "comics-offline";
export const OFFLINE_DATABASE_VERSION = 3;

export const OFFLINE_STORE_NAMES = {
	comics: "comics",
	progress: "progress",
} as const;

/** Stores from v2, when a generic outbox queued progress and library adds. */
const REMOVED_STORE_NAMES = ["outbox", "offline-state"];

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

function removeV2Stores(database: IDBDatabase): void {
	for (const name of REMOVED_STORE_NAMES) {
		if (database.objectStoreNames.contains(name)) {
			database.deleteObjectStore(name);
		}
	}
}

function createV3Indexes(transaction: IDBTransaction): void {
	const progress = transaction.objectStore(OFFLINE_STORE_NAMES.progress);
	if (!progress.indexNames.contains("syncStatus")) {
		progress.createIndex("syncStatus", "syncStatus", { unique: false });
	}
}

function migrateDatabase(
	database: IDBDatabase,
	transaction: IDBTransaction,
	oldVersion: number,
): void {
	if (oldVersion < 1) createV1Stores(database);
	if (oldVersion < 3) {
		// Pending progress records carry their own sync status, so dropping the
		// outbox loses no reading progress.
		removeV2Stores(database);
		createV3Indexes(transaction);
	}
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
			// The versionchange transaction always exists during an upgrade.
			const transaction = request.transaction as IDBTransaction;
			migrateDatabase(request.result, transaction, event.oldVersion);
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

async function countFromIndex(
	storeName: OfflineStoreName,
	indexName: string,
	query: IDBValidKey | IDBKeyRange,
): Promise<number> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(storeName, "readonly");
	const [result] = await Promise.all([
		requestResult(
			transaction.objectStore(storeName).index(indexName).count(query),
		),
		transactionComplete(transaction),
	]);
	return result;
}

/**
 * Compare-and-set a progress record in one transaction: `next` replaces the
 * stored record (or deletes it when null) only if `isCurrent` accepts it.
 * Returns false, leaving the store untouched, when it doesn't.
 */
async function updateProgressIfCurrent(
	issueId: string,
	isCurrent: (current: OfflineProgressRecord) => boolean,
	next: OfflineProgressRecord | null,
): Promise<boolean> {
	const database = await openOfflineDatabase();
	const transaction = database.transaction(
		OFFLINE_STORE_NAMES.progress,
		"readwrite",
	);
	const completed = transactionComplete(transaction);
	const store = transaction.objectStore(OFFLINE_STORE_NAMES.progress);
	const current = await requestResult<OfflineProgressRecord | undefined>(
		store.get(issueId),
	);
	const matches = current !== undefined && isCurrent(current);
	if (matches) {
		if (next) store.put(next);
		else store.delete(issueId);
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
	getByStatus: (syncStatus: OfflineProgressRecord["syncStatus"]) =>
		readAllFromIndex<OfflineProgressRecord>(
			OFFLINE_STORE_NAMES.progress,
			"syncStatus",
			syncStatus,
		),
	countByStatus: (syncStatus: OfflineProgressRecord["syncStatus"]) =>
		countFromIndex(OFFLINE_STORE_NAMES.progress, "syncStatus", syncStatus),
	put: (record: OfflineProgressRecord) =>
		putRecord(OFFLINE_STORE_NAMES.progress, record),
	updateIfCurrent: updateProgressIfCurrent,
	delete: (issueId: string) =>
		deleteRecord(OFFLINE_STORE_NAMES.progress, issueId),
	clear: () => clearStore(OFFLINE_STORE_NAMES.progress),
	count: () => countRecords(OFFLINE_STORE_NAMES.progress),
};
