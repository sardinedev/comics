import { OFFLINE_COVER_CACHE_NAME } from "@lib/offline/cache-names";
import type { OfflineComicRecord } from "@lib/offline/types";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
	CACHED_COMIC_METADATA_VERSION,
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

	test("migrates complete v1 bundles and preserves adjacency defaults", async () => {
		const issueId = trackIssueId(`migration-${crypto.randomUUID()}`);
		await caches.delete(COMIC_CACHE_NAME);
		const legacy = await caches.open(LEGACY_COMIC_CACHE_NAME);
		await putArchive(
			issueId,
			new Uint8Array([8, 6, 7, 5]),
			LEGACY_COMIC_CACHE_NAME,
		);
		await legacy.put(
			getComicMetadataUrl(issueId),
			new Response(
				JSON.stringify({
					...metadataFor(issueId, {
						previousIssue: undefined,
						nextIssue: undefined,
					}),
					version: 1,
					sizeBytes: 4,
					cachedAt: "2025-01-01T00:00:00.000Z",
					downloadUrl: getComicDownloadUrl(issueId),
				}),
			),
		);

		expect(await isIssueCached(issueId)).toBe(true);
		expect(await readCachedComicMetadata(issueId)).toMatchObject({
			version: CACHED_COMIC_METADATA_VERSION,
			issueId,
			previousIssue: null,
			nextIssue: null,
			cachedAt: "2025-01-01T00:00:00.000Z",
		});
		expect(await offlineComics.get(issueId)).toMatchObject({
			issueId,
			archiveCacheKey: getComicDownloadUrl(issueId),
		});
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

	test("keeps sidecar-less legacy archives readable but not complete", async () => {
		const issueId = trackIssueId(`legacy-${crypto.randomUUID()}`);
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
