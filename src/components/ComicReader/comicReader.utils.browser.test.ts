import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { zipSync } from "fflate";
import {
  downloadCbz,
  extractPages,
  getMimeType,
  isImageFile,
} from "./comicReader.utils";

/** Build a small in-memory CBZ archive containing fake "image" files. */
function buildCbz(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

const PNG_BYTES = new Uint8Array([
  // 8-byte PNG signature followed by junk — enough for our tests, which
  // never decode the image, only check that the blob URL exists.
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);

describe("isImageFile", () => {
  test.each([
    ["page.jpg", true],
    ["page.JPEG", true],
    ["page.png", true],
    ["page.webp", true],
    ["page.gif", true],
    ["page.txt", false],
    ["page", false],
    ["", false],
  ])("isImageFile(%j) === %s", (name, expected) => {
    expect(isImageFile(name)).toBe(expected);
  });
});

describe("getMimeType", () => {
  test.each([
    ["page.png", "image/png"],
    ["page.webp", "image/webp"],
    ["page.gif", "image/gif"],
    ["page.jpg", "image/jpeg"],
    ["page.jpeg", "image/jpeg"],
    ["unknown", "image/jpeg"],
  ])("getMimeType(%j) === %j", (name, expected) => {
    expect(getMimeType(name)).toBe(expected);
  });
});

describe("extractPages", () => {
  test("returns blob URLs sorted by filename", async () => {
    const cbz = buildCbz({
      "002.png": PNG_BYTES,
      "001.png": PNG_BYTES,
      "003.png": PNG_BYTES,
    });

    const urls = await extractPages(cbz);

    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.startsWith("blob:")).toBe(true);
    }
    // Cleanup
    urls.forEach(URL.revokeObjectURL);
  });

  test("filters out non-image entries and __MACOSX metadata", async () => {
    const cbz = buildCbz({
      "001.png": PNG_BYTES,
      "ComicInfo.xml": new TextEncoder().encode("<xml/>"),
      "__MACOSX/._001.png": PNG_BYTES,
    });

    const urls = await extractPages(cbz);

    expect(urls).toHaveLength(1);
    urls.forEach(URL.revokeObjectURL);
  });

  test("rejects when archive contains no images", async () => {
    const cbz = buildCbz({
      "ComicInfo.xml": new TextEncoder().encode("<xml/>"),
    });

    await expect(extractPages(cbz)).rejects.toThrow(/no pages/i);
  });

  test("rejects on corrupt archive", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(extractPages(garbage)).rejects.toThrow(/corrupt|unreadable/i);
  });
});

describe("downloadCbz", () => {
  // Scope cache writes to a unique URL per test so they don't bleed across
  // runs in the shared "comic-reader-v1" Cache Storage bucket.
  const issueId = `test-${crypto.randomUUID()}`;
  const url = `/api/comic/${issueId}/download`;
  const cbz = buildCbz({ "001.png": PNG_BYTES });

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    // Clear any cache entries we wrote across all variants of this test's URL.
    if (typeof caches !== "undefined") {
      const cache = await caches.open("comic-reader-v1");
      await cache.delete(url);
      await cache.delete(`/api/comic/${issueId}-err/download`);
      await cache.delete(`/api/comic/${issueId}-no-len/download`);
    }
  });

  test("fetches, reports progress, and caches on miss", async () => {
    const totalLength = cbz.byteLength;
    fetchSpy.mockResolvedValueOnce(
      new Response(cbz.buffer as ArrayBuffer, {
        status: 200,
        headers: { "Content-Length": String(totalLength) },
      }),
    );

    const progress: number[] = [];
    const out = await downloadCbz(issueId, (r) => progress.push(r));

    expect(out).toEqual(cbz);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toBeCloseTo(1, 5);

    // Second call should hit the cache (no new fetch).
    const out2 = await downloadCbz(issueId, () => { });
    expect(out2).toEqual(cbz);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("returns the cached archive without calling fetch on hit", async () => {
    // Pre-populate the cache directly so we can prove fetch is bypassed.
    const cache = await caches.open("comic-reader-v1");
    await cache.put(
      url,
      new Response(cbz.buffer as ArrayBuffer, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const progress: number[] = [];
    const out = await downloadCbz(issueId, (r) => progress.push(r));

    expect(out).toEqual(cbz);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Cache hits jump straight to 100%.
    expect(progress).toEqual([1]);
  });

  test("succeeds without Content-Length (skips progress updates)", async () => {
    // Stream a body with no Content-Length header. The reader should still
    // collect the full archive; only the progress callback should be skipped.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(cbz);
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const progress: number[] = [];
    const out = await downloadCbz(`${issueId}-no-len`, (r) => progress.push(r));

    expect(out).toEqual(cbz);
    expect(progress).toEqual([]);
  });

  test("throws when the response is not OK", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(downloadCbz(`${issueId}-err`, () => { })).rejects.toThrow(
      "boom",
    );
  });
});
