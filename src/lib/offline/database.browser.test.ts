import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { OFFLINE_CACHE_PREFIXES } from "./cache-names";
import { clearOfflineData } from "./clear";
import {
	closeOfflineDatabase,
	getOfflineDatabaseName,
	OFFLINE_DATABASE_NAME,
	OFFLINE_DATABASE_VERSION,
	OFFLINE_STORE_NAMES,
	offlineComics,
	offlineProgress,
	openOfflineDatabase,
	setOfflineDatabaseNameForTesting,
} from "./database";
import type { OfflineComicRecord, OfflineProgressRecord } from "./types";

const comic: OfflineComicRecord = {
	issueId: "issue-1",
	seriesId: "series-1",
	seriesName: "The Example",
	seriesYear: "2026",
	issueNumber: 1,
	archiveCacheKey: "/api/comic/issue-1/download",
	sizeBytes: 42,
	cachedAt: "2026-08-16T10:00:00.000Z",
	updatedAt: "2026-08-16T10:00:00.000Z",
};

const progress: OfflineProgressRecord = {
	issueId: comic.issueId,
	currentPage: 8,
	totalPages: 24,
	updatedAt: "2026-08-16T11:00:00.000Z",
	syncStatus: "pending",
};

const testRunId = crypto.randomUUID();
const TEST_DATABASE_NAME = `${OFFLINE_DATABASE_NAME}-database-browser-${testRunId}`;
const TEST_CACHE_NAMES = OFFLINE_CACHE_PREFIXES.map(
	(prefix) => `${prefix}database-browser-${testRunId}`,
);
const UNRELATED_TEST_CACHE_NAME = `unrelated-cache-${testRunId}`;

async function deleteTestDatabase(): Promise<void> {
	await closeOfflineDatabase();
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(getOfflineDatabaseName());
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error("Test database deletion blocked"));
	});
}

async function cleanOfflineTestData(): Promise<void> {
	await deleteTestDatabase();
}

beforeAll(() => setOfflineDatabaseNameForTesting(TEST_DATABASE_NAME));
beforeEach(cleanOfflineTestData);
afterEach(cleanOfflineTestData);
afterAll(async () => {
	await Promise.all(TEST_CACHE_NAMES.map((name) => caches.delete(name)));
	await caches.delete(UNRELATED_TEST_CACHE_NAME);
	await setOfflineDatabaseNameForTesting(OFFLINE_DATABASE_NAME);
});

/** Builds a database as an older release left it, then closes it. */
async function createLegacyDatabase(
	version: number,
	seed: { comics?: OfflineComicRecord[]; progress?: OfflineProgressRecord[] },
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(getOfflineDatabaseName(), version);
		request.onupgradeneeded = () => {
			const database = request.result;
			const comicsStore = database.createObjectStore(
				OFFLINE_STORE_NAMES.comics,
				{ keyPath: "issueId" },
			);
			comicsStore.createIndex("seriesId", "seriesId", { unique: false });
			comicsStore.createIndex("cachedAt", "cachedAt", { unique: false });
			const progressStore = database.createObjectStore(
				OFFLINE_STORE_NAMES.progress,
				{ keyPath: "issueId" },
			);
			progressStore.createIndex("updatedAt", "updatedAt", { unique: false });
			if (version >= 2) {
				const outbox = database.createObjectStore("outbox", { keyPath: "id" });
				outbox.createIndex("dedupeKey", "dedupeKey", { unique: true });
				database.createObjectStore("offline-state", { keyPath: "key" });
			}
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction(
				[OFFLINE_STORE_NAMES.comics, OFFLINE_STORE_NAMES.progress],
				"readwrite",
			);
			for (const record of seed.comics ?? []) {
				transaction.objectStore(OFFLINE_STORE_NAMES.comics).put(record);
			}
			for (const record of seed.progress ?? []) {
				transaction.objectStore(OFFLINE_STORE_NAMES.progress).put(record);
			}
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
			transaction.onerror = () => reject(transaction.error);
		};
	});
}

describe("offline database schema", () => {
	test("creates every current store and index", async () => {
		const database = await openOfflineDatabase();

		expect(database.version).toBe(OFFLINE_DATABASE_VERSION);
		expect(Array.from(database.objectStoreNames)).toEqual([
			OFFLINE_STORE_NAMES.comics,
			OFFLINE_STORE_NAMES.progress,
		]);

		const transaction = database.transaction(
			[OFFLINE_STORE_NAMES.comics, OFFLINE_STORE_NAMES.progress],
			"readonly",
		);
		const transactionDone = new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		expect(
			Array.from(
				transaction.objectStore(OFFLINE_STORE_NAMES.comics).indexNames,
			),
		).toEqual(["cachedAt", "seriesId"]);
		expect(
			Array.from(
				transaction.objectStore(OFFLINE_STORE_NAMES.progress).indexNames,
			),
		).toEqual(["syncStatus", "updatedAt"]);
		await transactionDone;
	});

	test("upgrades a version 1 database without losing records", async () => {
		const legacyRecord = { ...comic, seriesName: "Preserved from v1" };
		await createLegacyDatabase(1, { comics: [legacyRecord] });

		const database = await openOfflineDatabase();
		expect(database.version).toBe(OFFLINE_DATABASE_VERSION);
		expect(database.objectStoreNames.contains("outbox")).toBe(false);
		expect(await offlineComics.get(comic.issueId)).toEqual(legacyRecord);
	});

	test("drops the version 2 outbox but keeps pending progress queued", async () => {
		await createLegacyDatabase(2, { comics: [comic], progress: [progress] });

		const database = await openOfflineDatabase();
		expect(Array.from(database.objectStoreNames)).toEqual([
			OFFLINE_STORE_NAMES.comics,
			OFFLINE_STORE_NAMES.progress,
		]);
		expect(await offlineComics.get(comic.issueId)).toEqual(comic);
		expect(await offlineProgress.getByStatus("pending")).toEqual([progress]);
	});
});

describe("typed offline repositories", () => {
	test("creates, reads, queries, updates, and deletes comic metadata", async () => {
		const anotherComic: OfflineComicRecord = {
			...comic,
			issueId: "issue-2",
			issueNumber: 2,
			archiveCacheKey: "/api/comic/issue-2/download",
		};

		await offlineComics.put(comic);
		await offlineComics.put(anotherComic);
		expect(await offlineComics.count()).toBe(2);
		expect(await offlineComics.get(comic.issueId)).toEqual(comic);
		expect(await offlineComics.getBySeries(comic.seriesId)).toEqual([
			comic,
			anotherComic,
		]);

		await offlineComics.put({ ...comic, issueName: "Updated" });
		expect((await offlineComics.get(comic.issueId))?.issueName).toBe("Updated");
		await offlineComics.delete(comic.issueId);
		expect(await offlineComics.get(comic.issueId)).toBeUndefined();
		await offlineComics.clear();
		expect(await offlineComics.getAll()).toEqual([]);
	});

	test("stores progress and queries it by sync status", async () => {
		const synced: OfflineProgressRecord = {
			...progress,
			issueId: "issue-2",
			syncStatus: "synced",
		};
		const failed: OfflineProgressRecord = {
			...progress,
			issueId: "issue-3",
			syncStatus: "failed",
		};
		for (const record of [progress, synced, failed]) {
			await offlineProgress.put(record);
		}

		expect(await offlineProgress.get(progress.issueId)).toEqual(progress);
		expect(await offlineProgress.getByStatus("pending")).toEqual([progress]);
		expect(await offlineProgress.getByStatus("failed")).toEqual([failed]);
		expect(await offlineProgress.countByStatus("synced")).toBe(1);

		await offlineProgress.delete(progress.issueId);
		expect(await offlineProgress.countByStatus("pending")).toBe(0);
		expect(await offlineProgress.count()).toBe(2);
	});

	test("replaces or deletes progress only when it is still current", async () => {
		await offlineProgress.put(progress);
		const synced = { ...progress, syncStatus: "synced" } as const;

		await expect(
			offlineProgress.updateIfCurrent(progress.issueId, () => false, synced),
		).resolves.toBe(false);
		expect(await offlineProgress.get(progress.issueId)).toEqual(progress);

		await expect(
			offlineProgress.updateIfCurrent(progress.issueId, () => true, synced),
		).resolves.toBe(true);
		expect(await offlineProgress.get(progress.issueId)).toEqual(synced);

		await expect(
			offlineProgress.updateIfCurrent(progress.issueId, () => true, null),
		).resolves.toBe(true);
		expect(await offlineProgress.get(progress.issueId)).toBeUndefined();

		await expect(
			offlineProgress.updateIfCurrent(progress.issueId, () => true, synced),
		).resolves.toBe(false);
		expect(await offlineProgress.count()).toBe(0);
	});

	test("preserves a newer save queued before an old one settles", async () => {
		await offlineProgress.put(progress);
		const newer = { ...progress, currentPage: 15 };

		// Queue the newer write without waiting for its transaction.
		const write = offlineProgress.put(newer);
		const settled = offlineProgress.updateIfCurrent(
			progress.issueId,
			(current) => current.currentPage === progress.currentPage,
			{ ...progress, syncStatus: "synced" },
		);
		await write;

		expect(await settled).toBe(false);
		expect(await offlineProgress.get(progress.issueId)).toEqual(newer);
	});
});

describe("clearOfflineData", () => {
	test("deletes the offline database and all owned cache buckets", async () => {
		await offlineComics.put(comic);
		for (const cacheName of TEST_CACHE_NAMES) {
			const cache = await caches.open(cacheName);
			await cache.put("/stored", new Response(cacheName));
		}
		const unrelated = await caches.open(UNRELATED_TEST_CACHE_NAME);
		await unrelated.put("/keep", new Response("keep"));

		const result = await clearOfflineData({ cacheNames: TEST_CACHE_NAMES });

		expect(result.databaseDeleted).toBe(true);
		expect(result.deletedCaches.sort()).toEqual([...TEST_CACHE_NAMES].sort());
		const cacheNames = await caches.keys();
		expect(cacheNames).not.toContain(TEST_CACHE_NAMES[0]);
		expect(cacheNames).toContain(UNRELATED_TEST_CACHE_NAME);

		// A subsequent open creates a fresh, empty database.
		await openOfflineDatabase();
		expect(await offlineComics.getAll()).toEqual([]);
	});

	test("is idempotent when no offline data exists", async () => {
		await expect(
			clearOfflineData({ cacheNames: TEST_CACHE_NAMES }),
		).resolves.toEqual({
			databaseDeleted: true,
			deletedCaches: [],
		});
		await expect(
			clearOfflineData({ cacheNames: TEST_CACHE_NAMES }),
		).resolves.toEqual({
			databaseDeleted: true,
			deletedCaches: [],
		});
	});
});
