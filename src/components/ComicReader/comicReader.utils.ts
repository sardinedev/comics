import { unzip } from "fflate";

/** Image file extensions recognized as comic pages inside a CBZ archive. */
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Returns the lowercased file extension (including the leading dot), or an
 * empty string if the name has no extension.
 */
function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Returns `true` if the filename has an extension matching a supported
 * comic page image format ({@link IMAGE_EXTENSIONS}).
 */
export function isImageFile(name: string): boolean {
  const ext = getExt(name);
  return ext !== "" && IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Maps a filename to a Blob-compatible MIME type based on its extension.
 * Falls back to `image/jpeg` for unknown or missing extensions, since JPEG
 * is the most common format inside CBZ archives.
 */
export function getMimeType(name: string): string {
  const ext = getExt(name);
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Opens (or creates) the Cache Storage bucket used to persist downloaded
 * CBZ archives for offline reading. Returns `null` if the Cache API is
 * unavailable (e.g. insecure context, older browsers).
 */
async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches !== "undefined") return await caches.open("comic-reader-v1");
  } catch { /* Cache API unavailable (HTTP, older browser, etc.) */ }
  return null;
}

/**
 * Downloads the CBZ archive for an issue, with progress reporting and
 * transparent caching for offline reading.
 *
 * Behavior:
 * - Returns the cached archive immediately on cache hit (progress jumps to 1).
 * - On cache miss, streams the response body to report download progress,
 *   then stores the archive in the cache for future offline reads.
 * - Falls back to {@link Response.arrayBuffer} when the response has no
 *   readable stream body.
 *
 * @param issueId - Elasticsearch issue id used to build the download URL.
 * @param onProgress - Called with a ratio in `[0, 1]` as bytes are received.
 * @returns The full CBZ archive bytes.
 * @throws If the network response is not OK or the body cannot be read.
 */
export async function downloadCbz(
  issueId: string,
  onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
  const url = `/api/comic/${issueId}/download`;
  const cache = await openCache();

  // Check cache first
  if (cache) {
    const cached = await cache.match(url);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      onProgress(1);
      return new Uint8Array(buffer);
    }
  }

  // Fetch with progress tracking
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Download failed (${res.status})`);
  }

  const contentLength = Number(res.headers.get("Content-Length") ?? 0);

  // Fall back to arrayBuffer() if the response body isn't a readable stream
  // (rare, but possible in some environments / response types).
  if (!res.body) {
    const buffer = await res.arrayBuffer();
    onProgress(1);
    const cbz = new Uint8Array(buffer);
    if (cache) {
      await cache.put(
        url,
        new Response(cbz, {
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
    }
    return cbz;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  // Manual reader loop — Safari does not yet support async iteration of
  // ReadableStream (no [Symbol.asyncIterator]), so we cannot use `for await`.
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress(received / contentLength);
    }
  }

  // Combine chunks
  const cbz = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    cbz.set(chunk, offset);
    offset += chunk.length;
  }

  // Store in cache for offline reading (when available)
  if (cache) {
    await cache.put(
      url,
      new Response(cbz, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  }

  return cbz;
}

/**
 * Extracts comic pages from a CBZ (zip) archive and returns them as object
 * URLs ready to assign to `<img src>`. Pages are sorted alphabetically by
 * filename, matching the convention used elsewhere in this codebase.
 *
 * Decompression runs in a Web Worker (via fflate's async {@link unzip}) so
 * large archives don't block the main thread. Non-image entries and macOS
 * `__MACOSX/` metadata are filtered out before decompression.
 *
 * The caller is responsible for revoking the returned object URLs with
 * {@link URL.revokeObjectURL} when they are no longer needed.
 *
 * @param cbz - Raw CBZ archive bytes (typically from {@link downloadCbz}).
 * @returns A promise resolving to an array of object URLs, one per page,
 *   in display order.
 * @throws If the archive is corrupt/unreadable, or contains no images.
 */
export function extractPages(cbz: Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Async unzip runs in a Web Worker so large archives don't block the main thread.
    unzip(
      cbz,
      {
        filter: (file) =>
          !file.name.startsWith("__MACOSX/") && isImageFile(file.name),
      },
      (err, entries) => {
        if (err) {
          reject(new Error("Comic archive is corrupted or unreadable", { cause: err }));
          return;
        }

        const sortedNames = Object.keys(entries).sort((a, b) => a.localeCompare(b));

        if (sortedNames.length === 0) {
          reject(new Error("No pages found in archive"));
          return;
        }

        const urls = sortedNames.map((name) => {
          // Cast: fflate returns Uint8Array<ArrayBufferLike>, but Blob's lib.dom types
          // require Uint8Array<ArrayBuffer>. The runtime value is always a valid BlobPart.
          const blob = new Blob([entries[name] as BlobPart], { type: getMimeType(name) });
          return URL.createObjectURL(blob);
        });

        resolve(urls);
      },
    );
  });
}
