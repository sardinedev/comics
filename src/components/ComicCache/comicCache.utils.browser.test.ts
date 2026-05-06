import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMIC_CACHE_NAME,
  deleteCachedIssue,
  downloadIssueToCache,
  getComicDownloadUrl,
  getComicMetadataUrl,
  isIssueCached,
  listCachedComics,
  parseIssueIdFromDownloadUrl,
  readCachedComicMetadata,
  writeCachedComicMetadata,
} from "./comicCache.utils";

const cleanupIds = new Set<string>();

function trackIssueId(issueId: string): string {
  cleanupIds.add(issueId);
  return issueId;
}

async function putArchive(issueId: string, bytes = new Uint8Array([1, 2, 3])) {
  const cache = await caches.open(COMIC_CACHE_NAME);
  await cache.put(
    getComicDownloadUrl(issueId),
    new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }),
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
    const cache = await caches.open(COMIC_CACHE_NAME);
    await Promise.all(
      [...cleanupIds].flatMap((issueId) => [
        cache.delete(getComicDownloadUrl(issueId)),
        cache.delete(getComicMetadataUrl(issueId)),
      ]),
    );
    cleanupIds.clear();
  });

  test("parses issue IDs from archive cache keys", () => {
    expect(parseIssueIdFromDownloadUrl("/api/comic/abc/download")).toBe("abc");
    expect(parseIssueIdFromDownloadUrl("/api/comic/abc/cache-metadata")).toBeNull();
    expect(parseIssueIdFromDownloadUrl("/api/search?q=abc")).toBeNull();
  });

  test("writes, reads, lists, and deletes metadata sidecars", async () => {
    const issueId = trackIssueId(`sidecar-${crypto.randomUUID()}`);
    const archiveBytes = await putArchive(issueId, new Uint8Array([1, 2, 3, 4]));

    const written = await writeCachedComicMetadata(
      {
        issueId,
        seriesId: "series-1",
        seriesName: "Saga",
        issueNumber: 1,
        issueName: "One",
        coverUrl: "/covers/issue.jpg",
      },
      archiveBytes.byteLength,
    );

    expect(written?.issueId).toBe(issueId);
    expect(written?.sizeBytes).toBe(4);

    const read = await readCachedComicMetadata(issueId);
    expect(read?.seriesName).toBe("Saga");

    const comics = await listCachedComics();
    const comic = comics.find((entry) => entry.issueId === issueId);
    expect(comic).toMatchObject({
      issueId,
      sizeBytes: 4,
      metadata: expect.objectContaining({ issueName: "One" }),
    });

    const result = await deleteCachedIssue(issueId);
    expect(result.archiveDeleted).toBe(true);
    expect(result.metadataDeleted).toBe(true);
    expect(await isIssueCached(issueId)).toBe(false);
    expect(await readCachedComicMetadata(issueId)).toBeNull();
  });

  test("lists sidecar-less archives without metadata", async () => {
    const issueId = trackIssueId(`legacy-${crypto.randomUUID()}`);
    await putArchive(issueId, new Uint8Array([5, 6, 7, 8, 9]));

    const comics = await listCachedComics();
    const comic = comics.find((entry) => entry.issueId === issueId);

    expect(comic).toMatchObject({
      issueId,
      sizeBytes: 5,
      metadata: null,
    });
  });

  test("downloads archives and writes metadata on cache miss", async () => {
    const issueId = trackIssueId(`download-${crypto.randomUUID()}`);
    const archiveBytes = new Uint8Array([9, 8, 7, 6]);

    fetchSpy.mockResolvedValueOnce(
      new Response(archiveBytes, {
        status: 200,
        headers: { "Content-Length": String(archiveBytes.byteLength) },
      }),
    );

    const progress: number[] = [];
    const output = await downloadIssueToCache(
      issueId,
      (ratio) => progress.push(ratio),
      { issueId, seriesName: "Monstress", issueNumber: 2 },
    );

    expect(output).toEqual(archiveBytes);
    expect(progress.at(-1)).toBe(1);
    expect(await isIssueCached(issueId)).toBe(true);
    expect(await readCachedComicMetadata(issueId)).toMatchObject({
      issueId,
      seriesName: "Monstress",
      issueNumber: 2,
      sizeBytes: archiveBytes.byteLength,
    });
  });

  test("keeps the archive cached when metadata sidecar serialization fails", async () => {
    const issueId = trackIssueId(`metadata-fail-${crypto.randomUUID()}`);
    const archiveBytes = new Uint8Array([1, 3, 5, 7]);
    const circularMetadata = { issueId, seriesName: "Saga" } as any;
    circularMetadata.self = circularMetadata;

    fetchSpy.mockResolvedValueOnce(
      new Response(archiveBytes, {
        status: 200,
        headers: { "Content-Length": String(archiveBytes.byteLength) },
      }),
    );

    const output = await downloadIssueToCache(issueId, () => { }, circularMetadata);

    expect(output).toEqual(archiveBytes);
    expect(await isIssueCached(issueId)).toBe(true);
    expect(await readCachedComicMetadata(issueId)).toBeNull();
  });

  test("returns cached archives without fetching", async () => {
    const issueId = trackIssueId(`hit-${crypto.randomUUID()}`);
    const archiveBytes = await putArchive(issueId, new Uint8Array([4, 3, 2, 1]));

    const progress: number[] = [];
    const output = await downloadIssueToCache(issueId, (ratio) => progress.push(ratio));

    expect(output).toEqual(archiveBytes);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(progress).toEqual([1]);
  });
});
