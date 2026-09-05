import { OFFLINE_COVER_CACHE_NAME } from "@lib/offline/cache-names";
import type { OfflineComicRecord } from "@lib/offline/types";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function assertDefined<T>(
	value: T | undefined,
	message: string,
): asserts value is T {
	if (value === undefined) {
		throw new Error(message);
	}
}

const { offlineRecords } = vi.hoisted(() => ({
	offlineRecords: new Map<string, OfflineComicRecord>(),
}));

vi.mock("@lib/offline/database", () => ({
	offlineComics: {
		get: vi.fn(async (issueId: string) => offlineRecords.get(issueId)),
		put: vi.fn(async (record: OfflineComicRecord) => {
			offlineRecords.set(record.issueId, record);
		}),
		delete: vi.fn(async (issueId: string) => {
			offlineRecords.delete(issueId);
		}),
	},
}));

const { offlineComics } = await import("@lib/offline/database");

import {
	COMIC_CACHE_NAME,
	type ComicCacheMetadataInput,
	deleteCachedIssue,
	downloadIssueToCache,
	getCachedComicCoverUrl,
	getComicDownloadUrl,
	getComicMetadataUrl,
	isIssueCached,
	LEGACY_COMIC_CACHE_NAME,
	listCachedComics,
	openComicCache,
	parseIssueIdFromDownloadUrl,
	readCachedComicMetadata,
	retryCachedComicCover,
	writeCachedComicMetadata,
} from "./comicCache.utils";

const cleanupIds = new Set<string>();

function trackIssueId(issueId: string): string {
	cleanupIds.add(issueId);
	return issueId;
}

function metadataFor(
	issueId: string,
	overrides: Partial<ComicCacheMetadataInput> = {},
): ComicCacheMetadataInput {
	return {
		issueId,
		seriesId: "series-1",
		seriesName: "Saga",
		seriesYear: "2012",
		issueNumber: 2,
		issueName: "Chapter Two",
		issueDate: "2026-01-02",
		previousIssue: { issueId: "issue-1", issueNumber: 1 },
		nextIssue: { issueId: "issue-3", issueNumber: 3 },
		...overrides,
	};
}

async function putArchive(
	issueId: string,
	bytes = new Uint8Array([1, 2, 3]),
	cacheName = COMIC_CACHE_NAME,
) {
	const cache = await caches.open(cacheName);
	await cache.put(
		getComicDownloadUrl(issueId),
		new Response(bytes, {
			headers: { "Content-Type": "application/octet-stream" },
		}),
	);
	return bytes;
}

describe("comic cache utilities", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(async () => {
		fetchSpy.mockRestore();
		for (const cacheName of [COMIC_CACHE_NAME, LEGACY_COMIC_CACHE_NAME]) {
			const cache = await caches.open(cacheName);
			await Promise.all(
				[...cleanupIds].flatMap((issueId) => [
					cache.delete(getComicDownloadUrl(issueId)),
					cache.delete(getComicMetadataUrl(issueId)),
				]),
			);
		}
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		await Promise.all(
			[...cleanupIds].map((issueId) =>
				coverCache.delete(getCachedComicCoverUrl(issueId)),
			),
		);
		await Promise.all(
			[...cleanupIds].map((issueId) => offlineComics.delete(issueId)),
		);
		offlineRecords.clear();
		cleanupIds.clear();
	});

	test("parses issue IDs from archive cache keys", () => {
		expect(parseIssueIdFromDownloadUrl("/api/comic/abc/download")).toBe("abc");
		expect(
			parseIssueIdFromDownloadUrl("/api/comic/abc/cache-metadata"),
		).toBeNull();
		expect(parseIssueIdFromDownloadUrl("/api/search?q=abc")).toBeNull();
	});

	test("writes, reads, lists, and deletes metadata with adjacency", async () => {
		const issueId = trackIssueId(`sidecar-${crypto.randomUUID()}`);
		const archiveBytes = await putArchive(
			issueId,
			new Uint8Array([1, 2, 3, 4]),
		);
		const written = await writeCachedComicMetadata(
			metadataFor(issueId),
			archiveBytes.byteLength,
		);

		expect(written).toMatchObject({
			issueId,
			sizeBytes: 4,
			previousIssue: { issueId: "issue-1", issueNumber: 1 },
			nextIssue: { issueId: "issue-3", issueNumber: 3 },
		});
		const comics = await listCachedComics();
		expect(comics.find((entry) => entry.issueId === issueId)).toMatchObject({
			issueId,
			sizeBytes: 4,
			metadata: expect.objectContaining({ issueName: "Chapter Two" }),
		});
		expect(await offlineComics.get(issueId)).toMatchObject({
			issueId,
			seriesName: "Saga",
		});

		const result = await deleteCachedIssue(issueId);
		expect(result).toEqual({
			archiveDeleted: true,
			metadataDeleted: true,
			coverDeleted: false,
		});
		expect(await isIssueCached(issueId)).toBe(false);
		expect(await offlineComics.get(issueId)).toBeUndefined();
	});

	describe("isIssueCached projection invariants", () => {
		async function seedCompleteBundle(issueId: string) {
			const archiveBytes = await putArchive(
				issueId,
				new Uint8Array([1, 2, 3, 4]),
			);
			await writeCachedComicMetadata(
				metadataFor(issueId),
				archiveBytes.byteLength,
			);

			await listCachedComics();
		}

		test("is true when archive, sidecar, and projection all agree", async () => {
			const issueId = trackIssueId(`invariant-agree-${crypto.randomUUID()}`);
			await seedCompleteBundle(issueId);

			expect(await isIssueCached(issueId)).toBe(true);
		});

		test("is false when the projection record is missing", async () => {
			const issueId = trackIssueId(
				`invariant-no-projection-${crypto.randomUUID()}`,
			);
			await seedCompleteBundle(issueId);
			expect(await isIssueCached(issueId)).toBe(true);

			await offlineComics.delete(issueId);

			expect(await isIssueCached(issueId)).toBe(false);
		});

		test("is false when the projection's archiveCacheKey does not match the sidecar", async () => {
			const issueId = trackIssueId(`invariant-key-${crypto.randomUUID()}`);
			await seedCompleteBundle(issueId);
			expect(await isIssueCached(issueId)).toBe(true);

			const record = await offlineComics.get(issueId);
			assertDefined(record, "expected an offline-comics projection record");
			await offlineComics.put({
				...record,
				archiveCacheKey: getComicDownloadUrl("some-other-issue"),
			});

			expect(await isIssueCached(issueId)).toBe(false);
		});

		test("is false when the projection's updatedAt does not match the sidecar's cachedAt", async () => {
			const issueId = trackIssueId(
				`invariant-timestamp-${crypto.randomUUID()}`,
			);
			await seedCompleteBundle(issueId);
			expect(await isIssueCached(issueId)).toBe(true);

			const record = await offlineComics.get(issueId);
			assertDefined(record, "expected an offline-comics projection record");
			await offlineComics.put({
				...record,
				updatedAt: "2000-01-01T00:00:00.000Z",
			});

			expect(await isIssueCached(issueId)).toBe(false);
		});
	});

	test("preserves the bundle when deletion cannot open Cache Storage", async () => {
		const issueId = trackIssueId(`delete-unavailable-${crypto.randomUUID()}`);
		await putArchive(issueId);
		await writeCachedComicMetadata(metadataFor(issueId), 3);
		await listCachedComics();
		const openSpy = vi
			.spyOn(caches, "open")
			.mockRejectedValueOnce(new Error("unavailable"));
		try {
			await expect(deleteCachedIssue(issueId)).rejects.toThrow(
				"Comic cache unavailable",
			);
		} finally {
			openSpy.mockRestore();
		}
		expect(await isIssueCached(issueId)).toBe(true);
	});

	test.each([
		"archive",
		"metadata",
		"cover",
		"projection",
	])("attempts every bundle deletion when %s cleanup fails", async (failedPart) => {
		const issueId = trackIssueId(`delete-partial-${crypto.randomUUID()}`);
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockResolvedValueOnce(new Response("cover"));
		await downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { coverUrl: "/covers/delete.jpg" }),
		);
		await retryCachedComicCover(issueId);
		const keys = {
			archive: getComicDownloadUrl(issueId),
			metadata: getComicMetadataUrl(issueId),
			cover: getCachedComicCoverUrl(issueId),
		};
		const cache = await caches.open(COMIC_CACHE_NAME);
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		const cachePrototype = Object.getPrototypeOf(cache) as Cache;
		const originalDelete = cachePrototype.delete;
		const failure = new Error("storage deletion failed");
		const cacheDeleteSpy = vi
			.spyOn(cachePrototype, "delete")
			.mockImplementation(function (this: Cache, request, options) {
				const path = new URL(
					request instanceof Request ? request.url : request.toString(),
					location.origin,
				).pathname;
				if (
					failedPart !== "projection" &&
					path === keys[failedPart as keyof typeof keys]
				)
					return Promise.reject(failure);
				return originalDelete.call(this, request, options);
			});
		const recordDeleteSpy = vi.spyOn(offlineComics, "delete");
		if (failedPart === "projection")
			recordDeleteSpy.mockRejectedValueOnce(failure);
		try {
			await expect(deleteCachedIssue(issueId)).rejects.toMatchObject({
				errors: [failure],
			});
			if (failedPart === "projection")
				expect(recordDeleteSpy).toHaveBeenCalledWith(issueId);
			else expect(recordDeleteSpy).not.toHaveBeenCalledWith(issueId);
			for (const [part, key] of Object.entries(keys)) {
				expect(cacheDeleteSpy).toHaveBeenCalledWith(key);
				expect(
					Boolean(await (part === "cover" ? coverCache : cache).match(key)),
				).toBe(part === failedPart);
			}
			expect(await offlineComics.get(issueId)).toMatchObject({
				deletionPending: true,
			});
			expect(await isIssueCached(issueId)).toBe(false);
		} finally {
			cacheDeleteSpy.mockRestore();
			recordDeleteSpy.mockRestore();
		}
		await deleteCachedIssue(issueId);
		expect(await offlineComics.get(issueId)).toBeUndefined();
		for (const [part, key] of Object.entries(keys)) {
			expect(
				await (part === "cover" ? coverCache : cache).match(key),
			).toBeUndefined();
		}
	});

	test("preserves the bundle when cleanup intent cannot be saved", async () => {
		const issueId = trackIssueId(`cleanup-intent-${crypto.randomUUID()}`);
		fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
		await downloadIssueToCache(issueId, () => { }, metadataFor(issueId));
		const failure = new Error("cleanup intent write failed");
		const putSpy = vi
			.spyOn(offlineComics, "put")
			.mockRejectedValueOnce(failure);
		try {
			await expect(deleteCachedIssue(issueId)).rejects.toBe(failure);
			expect(await isIssueCached(issueId)).toBe(true);
			expect(
				(await offlineComics.get(issueId))?.deletionPending,
			).toBeUndefined();
		} finally {
			putSpy.mockRestore();
		}
	});

	test("keeps cleanup intent when both required cache deletions fail", async () => {
		const issueId = trackIssueId(`cleanup-pending-${crypto.randomUUID()}`);
		fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
		await downloadIssueToCache(issueId, () => { }, metadataFor(issueId));
		const cache = await caches.open(COMIC_CACHE_NAME);
		const cachePrototype = Object.getPrototypeOf(cache) as Cache;
		const originalDelete = cachePrototype.delete;
		const failure = new Error("cache deletion failed");
		const deleteSpy = vi
			.spyOn(cachePrototype, "delete")
			.mockImplementation(function (this: Cache, request, options) {
				const path = new URL(
					request instanceof Request ? request.url : request.toString(),
					location.origin,
				).pathname;
				if (
					[getComicDownloadUrl(issueId), getComicMetadataUrl(issueId)].includes(
						path,
					)
				)
					return Promise.reject(failure);
				return originalDelete.call(this, request, options);
			});
		try {
			await expect(deleteCachedIssue(issueId)).rejects.toMatchObject({
				errors: [failure, failure],
			});
			expect(await cache.match(getComicDownloadUrl(issueId))).toBeTruthy();
			expect(await readCachedComicMetadata(issueId)).not.toBeNull();
			await listCachedComics();
			expect(await offlineComics.get(issueId)).toMatchObject({
				deletionPending: true,
			});
			expect(await isIssueCached(issueId)).toBe(false);
			await expect(
				downloadIssueToCache(issueId, () => { }, metadataFor(issueId)),
			).rejects.toThrow("Comic deletion is pending");
		} finally {
			deleteSpy.mockRestore();
		}
		await deleteCachedIssue(issueId);
		expect(await offlineComics.get(issueId)).toBeUndefined();
	});

	test("attempts other deletions when opening the cover cache fails", async () => {
		const issueId = trackIssueId(`delete-cover-open-${crypto.randomUUID()}`);
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockResolvedValueOnce(new Response("cover"));
		await downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { coverUrl: "/covers/delete-open.jpg" }),
		);
		await expect(retryCachedComicCover(issueId)).resolves.toBe(true);
		const cache = await caches.open(COMIC_CACHE_NAME);
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		const failure = new Error("cover cache unavailable");
		const originalOpen = caches.open.bind(caches);
		const openSpy = vi.spyOn(caches, "open").mockImplementation((name) => {
			if (name === OFFLINE_COVER_CACHE_NAME) return Promise.reject(failure);
			return originalOpen(name);
		});
		try {
			await expect(deleteCachedIssue(issueId)).rejects.toMatchObject({
				errors: [failure],
			});
			expect(await cache.match(getComicDownloadUrl(issueId))).toBeUndefined();
			expect(await cache.match(getComicMetadataUrl(issueId))).toBeUndefined();
			expect(await offlineComics.get(issueId)).toMatchObject({
				deletionPending: true,
			});
			expect(
				await coverCache.match(getCachedComicCoverUrl(issueId)),
			).toBeTruthy();
		} finally {
			openSpy.mockRestore();
		}
		await expect(deleteCachedIssue(issueId)).resolves.toMatchObject({
			coverDeleted: true,
		});
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
	});

	test("downloads and commits archive, metadata, and cover bytes", async () => {
		const issueId = trackIssueId(`download-${crypto.randomUUID()}`);
		const coverUrl = `/covers/${issueId}.jpg`;
		const archiveBytes = new Uint8Array([9, 8, 7, 6]);
		fetchSpy
			.mockResolvedValueOnce(
				new Response(archiveBytes, {
					status: 200,
					headers: { "Content-Length": String(archiveBytes.byteLength) },
				}),
			)
			.mockResolvedValueOnce(
				new Response(new Uint8Array([4, 2]), { status: 200 }),
			);

		const progress: number[] = [];
		const output = await downloadIssueToCache(
			issueId,
			(ratio) => progress.push(ratio),
			metadataFor(issueId, { coverUrl }),
		);

		expect(output).toEqual(archiveBytes);
		expect(progress.at(-1)).toBe(1);
		expect(await isIssueCached(issueId)).toBe(true);
		await expect(retryCachedComicCover(issueId)).resolves.toBe(true);
		expect(await readCachedComicMetadata(issueId)).toMatchObject({
			coverState: "cached",
			coverCacheKey: getCachedComicCoverUrl(issueId),
		});
		expect(await offlineComics.get(issueId)).toMatchObject({
			issueId,
			seriesId: "series-1",
			archiveCacheKey: getComicDownloadUrl(issueId),
			coverCacheKey: getCachedComicCoverUrl(issueId),
			nextIssue: { issueId: "issue-3", issueNumber: 3 },
		});
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeTruthy();

		const deleted = await deleteCachedIssue(issueId);
		expect(deleted.coverDeleted).toBe(true);
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
		expect(await offlineComics.get(issueId)).toBeUndefined();
	});

	test("reuses the winning bytes and metadata when fresh downloads race", async () => {
		const issueId = trackIssueId(`download-race-${crypto.randomUUID()}`);
		const firstResponse = Promise.withResolvers<Response>();
		const secondResponse = Promise.withResolvers<Response>();
		const winningBytes = new Uint8Array([1, 2, 3]);
		fetchSpy
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);
		const firstDownload = downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { issueName: "Winner" }),
		);
		await expect.poll(() => fetchSpy.mock.calls.length).toBe(1);
		const secondDownload = downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { issueName: "Loser" }),
		);
		await expect.poll(() => fetchSpy.mock.calls.length).toBe(2);
		firstResponse.resolve(new Response(winningBytes));
		expect(await firstDownload).toEqual(winningBytes);
		const winningMetadata = await readCachedComicMetadata(issueId);
		secondResponse.resolve(new Response(new Uint8Array([9, 8, 7, 6, 5])));
		expect(await secondDownload).toEqual(winningBytes);
		expect(await readCachedComicMetadata(issueId)).toEqual(winningMetadata);
		expect(await offlineComics.get(issueId)).toMatchObject({
			sizeBytes: 3,
			issueName: "Winner",
		});
		const cache = await caches.open(COMIC_CACHE_NAME);
		const archive = await cache.match(getComicDownloadUrl(issueId));
		expect(await archive?.arrayBuffer()).toEqual(winningBytes.buffer);
		expect(await isIssueCached(issueId)).toBe(true);
	});

	test("keeps a readable bundle with placeholder metadata when cover fails", async () => {
		const issueId = trackIssueId(`cover-fail-${crypto.randomUUID()}`);
		const coverUrl = `/covers/${issueId}.jpg`;
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 3, 5, 7])))
			.mockResolvedValueOnce(new Response("missing", { status: 503 }));

		await downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { coverUrl, coverThumbHash: "thumb" }),
		);
		await expect(retryCachedComicCover(issueId)).resolves.toBe(false);

		expect(await isIssueCached(issueId)).toBe(true);
		expect(await readCachedComicMetadata(issueId)).toMatchObject({
			coverState: "pending",
			coverThumbHash: "thumb",
		});

		fetchSpy.mockResolvedValueOnce(
			new Response(new Uint8Array([2, 4, 6]), { status: 200 }),
		);
		await expect(retryCachedComicCover(issueId)).resolves.toBe(true);
		expect(await readCachedComicMetadata(issueId)).toMatchObject({
			coverState: "cached",
			coverCacheKey: getCachedComicCoverUrl(issueId),
		});
	});

	test("commits a readable bundle without waiting for an optional cover", async () => {
		const issueId = trackIssueId(`cover-stalled-${crypto.randomUUID()}`);
		const cover = Promise.withResolvers<Response>();
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockReturnValueOnce(cover.promise);
		try {
			await downloadIssueToCache(
				issueId,
				() => { },
				metadataFor(issueId, { coverUrl: "/covers/stalled.jpg" }),
			);
			await expect.poll(() => fetchSpy.mock.calls.length).toBe(2);
			expect(await isIssueCached(issueId)).toBe(true);
			expect(await readCachedComicMetadata(issueId)).toMatchObject({
				coverState: "pending",
			});
		} finally {
			cover.resolve(new Response("cover"));
			await retryCachedComicCover(issueId);
		}
	});

	test("does not resurrect a bundle deleted during a cover fetch", async () => {
		const issueId = trackIssueId(`cover-deleted-${crypto.randomUUID()}`);
		const cover = Promise.withResolvers<Response>();
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockReturnValueOnce(cover.promise);
		await downloadIssueToCache(
			issueId,
			() => { },
			metadataFor(issueId, { coverUrl: "/covers/deleted.jpg" }),
		);
		await expect.poll(() => fetchSpy.mock.calls.length).toBe(2);
		const retry = retryCachedComicCover(issueId);
		try {
			await deleteCachedIssue(issueId);
		} finally {
			cover.resolve(new Response("cover"));
		}
		await expect(retry).resolves.toBe(false);
		expect(await offlineComics.get(issueId)).toBeUndefined();
		expect(await readCachedComicMetadata(issueId)).toBeNull();
		const cache = await caches.open(COMIC_CACHE_NAME);
		expect(await cache.match(getComicDownloadUrl(issueId))).toBeUndefined();
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
	});

	test("serializes deletion behind an active cover write", async () => {
		const issueId = trackIssueId(`cover-writing-${crypto.randomUUID()}`);
		const coverWriteStarted = Promise.withResolvers<void>();
		const finishCoverWrite = Promise.withResolvers<void>();
		const putSpy = vi
			.spyOn(offlineComics, "put")
			.mockImplementation(async (record) => {
				if (record.issueId === issueId && record.coverCacheKey) {
					coverWriteStarted.resolve();
					await finishCoverWrite.promise;
				}
				offlineRecords.set(record.issueId, record);
			});
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockResolvedValueOnce(new Response("cover"));
		let deletion: Promise<unknown> | undefined;
		try {
			await downloadIssueToCache(
				issueId,
				() => { },
				metadataFor(issueId, { coverUrl: "/covers/writing.jpg" }),
			);
			await coverWriteStarted.promise;
			deletion = deleteCachedIssue(issueId);
			await expect
				.poll(async () =>
					(await navigator.locks.query()).pending?.some(
						(lock) => lock.name === `comic-bundle:${issueId}`,
					),
				)
				.toBe(true);
		} finally {
			finishCoverWrite.resolve();
			await retryCachedComicCover(issueId);
			await deletion;
			putSpy.mockRestore();
		}
		expect(await offlineComics.get(issueId)).toBeUndefined();
		expect(await readCachedComicMetadata(issueId)).toBeNull();
		const cache = await caches.open(COMIC_CACHE_NAME);
		expect(await cache.match(getComicDownloadUrl(issueId))).toBeUndefined();
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
	});

	test.each([
		NaN,
		Infinity,
		-Infinity,
	])("rejects non-finite issue and neighbor numbers: %s", async (issueNumber) => {
		const issueId = trackIssueId(`invalid-number-${crypto.randomUUID()}`);
		for (const overrides of [
			{ issueNumber },
			{ previousIssue: { issueId: "previous", issueNumber } },
			{ nextIssue: { issueId: "next", issueNumber } },
		]) {
			await expect(
				downloadIssueToCache(
					issueId,
					() => { },
					metadataFor(issueId, overrides),
				),
			).rejects.toThrow("requires issue, series, and issue-number fields");
		}
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await offlineComics.get(issueId)).toBeUndefined();
		expect(await readCachedComicMetadata(issueId)).toBeNull();
	});

	test("rejects invalid required metadata before fetching or writing", async () => {
		const issueId = trackIssueId(`invalid-${crypto.randomUUID()}`);
		await expect(
			downloadIssueToCache(issueId, () => { }, {
				issueId,
				seriesName: "Saga",
				issueNumber: 1,
			}),
		).rejects.toThrow("requires issue, series, and issue-number fields");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await isIssueCached(issueId)).toBe(false);
	});

	test("rolls back the archive when required metadata cannot serialize", async () => {
		const issueId = trackIssueId(`metadata-fail-${crypto.randomUUID()}`);
		type CircularMetadata = ComicCacheMetadataInput & {
			self?: CircularMetadata;
		};
		const circularMetadata: CircularMetadata = metadataFor(issueId);
		circularMetadata.self = circularMetadata;
		fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 3, 5, 7])));

		await expect(
			downloadIssueToCache(issueId, () => { }, circularMetadata),
		).rejects.toThrow();
		expect(await isIssueCached(issueId)).toBe(false);
		expect(await readCachedComicMetadata(issueId)).toBeNull();
	});

	test("rolls back metadata and cover when the archive commit fails", async () => {
		const issueId = trackIssueId(`archive-fail-${crypto.randomUUID()}`);
		const coverUrl = `/covers/${issueId}.jpg`;
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockResolvedValueOnce(new Response(new Uint8Array([4, 5])));
		const cache = await openComicCache();
		expect(cache).not.toBeNull();
		const cachePrototype = Object.getPrototypeOf(cache) as Cache;
		const originalPut = cachePrototype.put;
		const putSpy = vi
			.spyOn(cachePrototype, "put")
			.mockImplementation(async function (
				this: Cache,
				request: RequestInfo | URL,
				response: Response,
			) {
				const url =
					typeof request === "string"
						? request
						: request instanceof Request
							? request.url
							: request.toString();
				if (url.endsWith(`/api/comic/${issueId}/download`)) {
					throw new Error("quota exceeded");
				}
				return originalPut.call(this, request, response);
			});

		await expect(
			downloadIssueToCache(
				issueId,
				() => { },
				metadataFor(issueId, { coverUrl }),
			),
		).rejects.toThrow("quota exceeded");
		putSpy.mockRestore();
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		expect(await cache?.match(getComicDownloadUrl(issueId))).toBeUndefined();
		expect(await cache?.match(getComicMetadataUrl(issueId))).toBeUndefined();
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
		expect(await offlineComics.get(issueId)).toBeUndefined();
	});

	test("rolls back Cache Storage when the searchable metadata write fails", async () => {
		const issueId = trackIssueId(`idb-fail-${crypto.randomUUID()}`);
		const coverUrl = `/covers/${issueId}.jpg`;
		fetchSpy
			.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
			.mockResolvedValueOnce(new Response(new Uint8Array([4, 5])));
		const putSpy = vi
			.spyOn(offlineComics, "put")
			.mockRejectedValueOnce(new Error("IndexedDB quota exceeded"));

		await expect(
			downloadIssueToCache(
				issueId,
				() => { },
				metadataFor(issueId, { coverUrl }),
			),
		).rejects.toThrow("IndexedDB quota exceeded");
		putSpy.mockRestore();
		const cache = await caches.open(COMIC_CACHE_NAME);
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		expect(await cache.match(getComicDownloadUrl(issueId))).toBeUndefined();
		expect(await cache.match(getComicMetadataUrl(issueId))).toBeUndefined();
		expect(
			await coverCache.match(getCachedComicCoverUrl(issueId)),
		).toBeUndefined();
	});

	test.each([
		"sidecar",
		"projection",
	])("preserves an existing archive when an upgrade fails at %s", async (failureStage) => {
		const issueId = trackIssueId(`upgrade-fail-${crypto.randomUUID()}`);
		const archiveBytes = await putArchive(
			issueId,
			new Uint8Array([4, 3, 2, 1]),
		);
		const metadata = metadataFor(issueId);
		const putSpy = vi.spyOn(offlineComics, "put");
		if (failureStage === "sidecar") Object.assign(metadata, { self: metadata });
		else putSpy.mockRejectedValueOnce(new Error("projection failed"));
		try {
			await expect(
				downloadIssueToCache(issueId, () => { }, metadata),
			).rejects.toThrow();
			expect(await downloadIssueToCache(issueId, () => { })).toEqual(
				archiveBytes,
			);
			expect(await readCachedComicMetadata(issueId)).toBeNull();
			expect(await offlineComics.get(issueId)).toBeUndefined();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			putSpy.mockRestore();
		}
	});

	test("rolls back required records without opening the optional cover cache", async () => {
		const issueId = trackIssueId(`rollback-cover-${crypto.randomUUID()}`);
		await openComicCache();
		const failure = new Error("projection quota exceeded");
		const putSpy = vi
			.spyOn(offlineComics, "put")
			.mockRejectedValueOnce(failure);
		const originalOpen = caches.open.bind(caches);
		const openSpy = vi.spyOn(caches, "open").mockImplementation((name) => {
			if (name === OFFLINE_COVER_CACHE_NAME)
				return Promise.reject(new Error("cover cache unavailable"));
			return originalOpen(name);
		});
		fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
		try {
			await expect(
				downloadIssueToCache(issueId, () => { }, metadataFor(issueId)),
			).rejects.toBe(failure);
			expect(openSpy).not.toHaveBeenCalledWith(OFFLINE_COVER_CACHE_NAME);
			const cache = await originalOpen(COMIC_CACHE_NAME);
			expect(await cache.match(getComicDownloadUrl(issueId))).toBeUndefined();
			expect(await cache.match(getComicMetadataUrl(issueId))).toBeUndefined();
			expect(await offlineComics.get(issueId)).toBeUndefined();
		} finally {
			putSpy.mockRestore();
			openSpy.mockRestore();
		}
	});

	test("keeps a cached archive without a sidecar readable but not complete", async () => {
		const issueId = trackIssueId(`no-sidecar-${crypto.randomUUID()}`);
		const archiveBytes = await putArchive(
			issueId,
			new Uint8Array([4, 3, 2, 1]),
		);
		const output = await downloadIssueToCache(issueId, () => { });

		expect(output).toEqual(archiveBytes);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await isIssueCached(issueId)).toBe(false);
	});

	test("records the original cover URL alongside its downloaded bytes", async () => {
		const issueId = trackIssueId("cover-source-review");
		const metadata = metadataFor(issueId, {
			coverUrl: "/covers/source-review.jpg",
		});
		fetchSpy.mockImplementation(
			async (url: RequestInfo | URL) =>
				new Response(
					String(url).includes("covers") ? "cover bytes" : "archive bytes",
				),
		);
		await downloadIssueToCache(issueId, () => { }, metadata);
		await expect(retryCachedComicCover(issueId)).resolves.toBe(true);
		const cover = await (await caches.open(OFFLINE_COVER_CACHE_NAME)).match(
			getCachedComicCoverUrl(issueId),
		);
		expect(cover?.headers.get("x-comics-cover-url")).toBe(
			new URL("/covers/source-review.jpg", location.origin).href,
		);
		expect(await cover?.text()).toBe("cover bytes");
		await deleteCachedIssue(issueId);
		expect(
			await (await caches.open(OFFLINE_COVER_CACHE_NAME)).match(
				getCachedComicCoverUrl(issueId),
			),
		).toBeUndefined();
	});
});
