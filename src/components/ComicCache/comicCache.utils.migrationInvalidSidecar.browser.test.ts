import { afterEach, describe, expect, test, vi } from "vitest";
import {
	COMIC_CACHE_NAME,
	getComicDownloadUrl,
	getComicMetadataUrl,
	isIssueCached,
	LEGACY_COMIC_CACHE_NAME,
	readCachedComicMetadata,
} from "./comicCache.utils";

function assertDefined<T>(
	value: T | undefined,
	message: string,
): asserts value is T {
	if (value === undefined) {
		throw new Error(message);
	}
}

const { offlineRecords } = vi.hoisted(() => ({
	offlineRecords: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@lib/offline/database", () => ({
	offlineComics: {
		get: vi.fn(async (issueId: string) => offlineRecords.get(issueId)),
		put: vi.fn(async (record: { issueId: string }) => {
			offlineRecords.set(record.issueId, record);
		}),
		delete: vi.fn(async (issueId: string) => {
			offlineRecords.delete(issueId);
		}),
	},
}));

const { offlineComics } = await import("@lib/offline/database");

describe("legacy (v1) comic cache migration: invalid sidecar", () => {
	afterEach(async () => {
		await caches.delete(COMIC_CACHE_NAME);
		await caches.delete(LEGACY_COMIC_CACHE_NAME);
		offlineRecords.clear();
	});

	test("keeps a v1 bundle with an invalid sidecar readable without a complete projection", async () => {
		const issueId = `migration-invalid-sidecar-${crypto.randomUUID()}`;
		const archiveBytes = new Uint8Array([1, 2, 3, 4]);
		const legacy = await caches.open(LEGACY_COMIC_CACHE_NAME);
		await legacy.put(
			getComicDownloadUrl(issueId),
			new Response(archiveBytes, {
				headers: { "Content-Type": "application/octet-stream" },
			}),
		);
		await legacy.put(
			getComicMetadataUrl(issueId),
			new Response(
				JSON.stringify({
					issueId,
					seriesId: "series-1",
					issueNumber: 2,
					version: 1,
					sizeBytes: 4,
					cachedAt: "2025-01-01T00:00:00.000Z",
					downloadUrl: getComicDownloadUrl(issueId),
				}),
			),
		);

		expect(await isIssueCached(issueId)).toBe(false);
		expect(await readCachedComicMetadata(issueId)).toBeNull();
		const current = await caches.open(COMIC_CACHE_NAME);
		const migrated = await current.match(getComicDownloadUrl(issueId));
		assertDefined(migrated, "expected the migrated archive to be readable");
		expect(new Uint8Array(await migrated.arrayBuffer())).toEqual(archiveBytes);
		expect(await offlineComics.get(issueId)).toBeUndefined();
	});
});
