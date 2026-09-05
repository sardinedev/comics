import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CACHED_COMIC_METADATA_VERSION,
  COMIC_CACHE_NAME,
  getComicDownloadUrl,
  getComicMetadataUrl,
  isIssueCached,
  LEGACY_COMIC_CACHE_NAME,
  readCachedComicMetadata,
} from "./comicCache.utils";

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

describe("legacy (v1) comic cache migration: complete bundle", () => {
  afterEach(async () => {
    await caches.delete(COMIC_CACHE_NAME);
    await caches.delete(LEGACY_COMIC_CACHE_NAME);
    offlineRecords.clear();
  });

  test("migrates complete v1 bundles and preserves adjacency defaults", async () => {
    const issueId = `migration-${crypto.randomUUID()}`;
    const legacy = await caches.open(LEGACY_COMIC_CACHE_NAME);
    await legacy.put(
      getComicDownloadUrl(issueId),
      new Response(new Uint8Array([8, 6, 7, 5]), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    await legacy.put(
      getComicMetadataUrl(issueId),
      new Response(
        JSON.stringify({
          issueId,
          seriesId: "series-1",
          seriesName: "Saga",
          seriesYear: "2012",
          issueNumber: 2,
          issueName: "Chapter Two",
          issueDate: "2026-01-02",
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
});
