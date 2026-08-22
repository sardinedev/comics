import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { KNOWN_OFFLINE_CACHE_NAMES } from "./cache-names";
import { clearOfflineData } from "./clear";
import {
	closeOfflineDatabase,
	getOfflineDatabaseName,
	OFFLINE_DATABASE_NAME,
	OFFLINE_DATABASE_VERSION,
	OFFLINE_STORE_NAMES,
	offlineComics,
	offlineOutbox,
	offlineProgress,
	offlineState,
	openOfflineDatabase,
	queueProgressUpdate,
	setOfflineDatabaseNameForTesting,
} from "./database";
import type {
	OfflineComicRecord,
	OfflineOutboxRecord,
	OfflineProgressRecord,
} from "./types";

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
	updatedAt: "2026-08-16T11:00:00.000Z",
	syncStatus: "pending",
};

const progressMutation: OfflineOutboxRecord = {
	id: "mutation-1",
	dedupeKey: `progress:${comic.issueId}`,
	kind: "progress",
	payload: {
		issueId: comic.issueId,
		currentPage: progress.currentPage,
		totalPages: 24,
		updatedAt: progress.updatedAt,
		mutationId: "mutation-1",
	},
	createdAt: "2026-08-16T11:00:00.000Z",
	updatedAt: "2026-08-16T11:00:00.000Z",
	attempts: 0,
	status: "pending",
};

const testRunId = crypto.randomUUID();
const TEST_DATABASE_NAME = `${OFFLINE_DATABASE_NAME}-database-browser-${testRunId}`;
const TEST_CACHE_NAMES = KNOWN_OFFLINE_CACHE_NAMES.map(
	(name) => `${name}-database-browser-${testRunId}`,
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

describe("offline database schema", () => {
	test("creates every current store and index", async () => {
		const database = await openOfflineDatabase();

		expect(database.version).toBe(OFFLINE_DATABASE_VERSION);
		expect(Array.from(database.objectStoreNames)).toEqual([
			OFFLINE_STORE_NAMES.comics,
			OFFLINE_STORE_NAMES.state,
			OFFLINE_STORE_NAMES.outbox,
			OFFLINE_STORE_NAMES.progress,
		]);

		const transaction = database.transaction(
			[OFFLINE_STORE_NAMES.comics, OFFLINE_STORE_NAMES.outbox],
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
				transaction.objectStore(OFFLINE_STORE_NAMES.outbox).indexNames,
			),
		).toEqual(["createdAt", "dedupeKey", "kind"]);
		await transactionDone;
	});

	test("upgrades a version 1 database without losing records", async () => {
		const legacyRecord = { ...comic, seriesName: "Preserved from v1" };
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(getOfflineDatabaseName(), 1);
			request.onupgradeneeded = () => {
				const comicsStore = request.result.createObjectStore(
					OFFLINE_STORE_NAMES.comics,
					{
						keyPath: "issueId",
					},
				);
				comicsStore.createIndex("seriesId", "seriesId", { unique: false });
				comicsStore.createIndex("cachedAt", "cachedAt", { unique: false });
				const progressStore = request.result.createObjectStore(
					OFFLINE_STORE_NAMES.progress,
					{
						keyPath: "issueId",
					},
				);
				progressStore.createIndex("updatedAt", "updatedAt", {
					unique: false,
				});
			};
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const database = request.result;
				const transaction = database.transaction(
					OFFLINE_STORE_NAMES.comics,
					"readwrite",
				);
				transaction.objectStore(OFFLINE_STORE_NAMES.comics).put(legacyRecord);
				transaction.oncomplete = () => {
					database.close();
					resolve();
				};
				transaction.onerror = () => reject(transaction.error);
			};
		});

		const database = await openOfflineDatabase();
		expect(database.version).toBe(OFFLINE_DATABASE_VERSION);
		expect(database.objectStoreNames.contains(OFFLINE_STORE_NAMES.outbox)).toBe(
			true,
		);
		expect(database.objectStoreNames.contains(OFFLINE_STORE_NAMES.state)).toBe(
			true,
		);
		expect(await offlineComics.get(comic.issueId)).toEqual(legacyRecord);
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

	test("stores progress and arbitrary typed offline state", async () => {
		await offlineProgress.put(progress);
		expect(await offlineProgress.get(progress.issueId)).toEqual(progress);

		await offlineState.set("readiness", { ready: true }, progress.updatedAt);
		expect(await offlineState.get<{ ready: boolean }>("readiness")).toEqual({
			ready: true,
		});
		expect(await offlineState.getRecord("readiness")).toEqual({
			key: "readiness",
			value: { ready: true },
			updatedAt: progress.updatedAt,
		});

		await offlineProgress.delete(progress.issueId);
		await offlineState.delete("readiness");
		expect(await offlineProgress.count()).toBe(0);
		expect(await offlineState.count()).toBe(0);
	});

	test("orders outbox records and replaces matching dedupe keys", async () => {
		const libraryMutation: OfflineOutboxRecord = {
			id: "mutation-2",
			dedupeKey: "library:series-1",
			kind: "add-to-library",
			payload: { seriesId: "series-1" },
			createdAt: "2026-08-16T10:00:00.000Z",
			updatedAt: "2026-08-16T10:00:00.000Z",
			attempts: 0,
			status: "pending",
		};
		await offlineOutbox.put(progressMutation);
		await offlineOutbox.put(libraryMutation);

		expect((await offlineOutbox.getAll()).map(({ id }) => id)).toEqual([
			"mutation-2",
			"mutation-1",
		]);
		expect(await offlineOutbox.getByKind("progress")).toEqual([
			progressMutation,
		]);

		const replacement = {
			...progressMutation,
			id: "mutation-3",
			payload: { ...progressMutation.payload, currentPage: 12 },
		};
		await offlineOutbox.put(replacement);
		expect(await offlineOutbox.get(progressMutation.id)).toBeUndefined();
		expect(
			await offlineOutbox.getByDedupeKey(progressMutation.dedupeKey),
		).toEqual(replacement);
		expect(await offlineOutbox.count()).toBe(2);
	});

	test("writes local progress and its outbox entry atomically", async () => {
		await queueProgressUpdate(progress, progressMutation);
		expect(await offlineProgress.get(progress.issueId)).toEqual(progress);
		expect(await offlineOutbox.get(progressMutation.id)).toEqual(
			progressMutation,
		);

		await expect(
			queueProgressUpdate(progress, {
				...progressMutation,
				id: "wrong-target",
				payload: { ...progressMutation.payload, issueId: "issue-2" },
			}),
		).rejects.toThrow("must target the same issue");
		expect(await offlineOutbox.get("wrong-target")).toBeUndefined();
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
