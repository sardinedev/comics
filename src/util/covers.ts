import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { mylarDownloadIssue, mylarGetSeriesArt } from "./mylar";

// Use dynamic import for unzipper since it's a CJS module
let unzipper: typeof import("unzipper") | null = null;
async function getUnzipper() {
  if (!unzipper) {
    unzipper = await import("unzipper");
  }
  return unzipper;
}

const COVERS_DIR = import.meta.env.COVERS_DIR ?? process.env.COVERS_DIR ?? "data/covers";

/**
 * Image file extensions to look for in CBZ archives.
 */
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Returns the local file path for a cached cover.
 * @param issueId The issue ID
 * @returns Absolute file path
 */
export function getCoverFilePath(issueId: string): string {
  return path.join(process.cwd(), COVERS_DIR, `${issueId}.jpg`);
}

/**
 * Returns the local URL path for serving a cover.
 * @param issueId The issue ID
 * @returns URL path like "/covers/12345.jpg"
 */
export function getCoverUrl(issueId: string): string {
  return `/covers/${issueId}.jpg`;
}

/**
 * Checks if a cover file exists on disk.
 * @param issueId The issue ID
 * @returns true if the cover file exists
 */
export async function coverExists(issueId: string): Promise<boolean> {
  try {
    await fs.access(getCoverFilePath(issueId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the covers directory exists.
 */
async function ensureCoversDir(): Promise<void> {
  const dir = path.join(process.cwd(), COVERS_DIR);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Saves cover bytes to disk.
 * @param issueId The issue ID
 * @param data The image data
 */
async function saveCover(issueId: string, data: Uint8Array): Promise<void> {
  await ensureCoversDir();
  const filePath = getCoverFilePath(issueId);
  await fs.writeFile(filePath, data);
}

/**
 * Reads a cached cover from disk.
 * @param issueId The issue ID
 * @returns Uint8Array or null if not found
 */
export async function readCover(issueId: string): Promise<Uint8Array | null> {
  try {
    const filePath = getCoverFilePath(issueId);
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Result type for cover caching operations with detailed error info.
 */
export type CoverCacheResult = {
  success: true;
  url: string;
  source: "cached" | "cbz" | "series-art";
} | {
  success: false;
  reason: string;
};

/**
 * Checks if a filename is an image based on extension.
 */
function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}
/**
 * Detects the archive type from magic bytes.
 * @param data The archive data
 * @return "zip", "rar", or "unknown"
 */
function detectArchiveType(data: Uint8Array): "zip" | "rar" | "unknown" {
  if (data.length < 4) return "unknown";
  
  // ZIP: starts with "PK" (0x50 0x4B)
  if (data[0] === 0x50 && data[1] === 0x4B) {
    return "zip";
  }
  
  // RAR: starts with "Rar!" (0x52 0x61 0x72 0x21)
  if (data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 && data[3] === 0x21) {
    return "rar";
  }
  
  return "unknown";
}

async function extractCoverFromCbz(archiveData: Uint8Array): Promise<Uint8Array | null> {
  // Detect archive type
  const archiveType = detectArchiveType(archiveData);
  
  if (archiveType === "rar") {
    // CBR (RAR) files are not supported by unzipper
    console.warn(
      `Archive is CBR (RAR format) - not supported. Size: ${(archiveData.length / 1024 / 1024).toFixed(2)} MB`
    );
    return null;
  }
  
  if (archiveType === "unknown") {
    console.error(
      `Unknown archive format. First bytes: ${Array.from(archiveData.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
    );
    // If it looks like text, show a preview
    if (archiveData[0] < 128 && archiveData[1] < 128) {
      const textPreview = new TextDecoder().decode(archiveData.slice(0, 200));
      console.error(`Data looks like text: ${textPreview}`);
    }
    return null;
  }

  console.info(`Parsing CBZ (ZIP) archive: ${(archiveData.length / 1024 / 1024).toFixed(2)} MB`);
  
  try {
    const unzip = await getUnzipper();
    
    // Use streaming approach - more robust for various ZIP formats
    return new Promise<Uint8Array | null>((resolve) => {
      const chunks: { path: string; buffer: Uint8Array }[] = [];
      let resolved = false;
      // Multiple events (close/error/source error) can fire in different orders.
      // Guard resolution so the Promise settles once and we don't attempt multiple resolves.
      const resolveOnce = (value: Uint8Array | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      
      const stream = unzip.Parse();
      
      stream.on("entry", async (entry) => {
        const filePath = entry.path;
        
        // Skip non-image files and macOS metadata
        if (filePath.startsWith("__MACOSX") || !isImageFile(filePath)) {
          entry.autodrain();
          return;
        }
        
        // Collect the entry data
        const buffers: Uint8Array[] = [];
        entry.on("data", (chunk: Buffer) => buffers.push(new Uint8Array(chunk)));
        entry.on("end", () => {
          const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const buf of buffers) {
            combined.set(buf, offset);
            offset += buf.length;
          }
          chunks.push({ path: filePath, buffer: combined });
        });
      });
      
      stream.on("close", () => {
        if (chunks.length === 0) {
          console.error("No image files found in CBZ archive");
          resolveOnce(null);
          return;
        }
        
        // Sort alphabetically to get cover (usually first)
        chunks.sort((a, b) => a.path.localeCompare(b.path));
        const cover = chunks[0];
        console.info(`Extracted cover: ${cover.path}`);
        resolveOnce(cover.buffer);
      });
      
      stream.on("error", (err) => {
        console.error("Error parsing CBZ stream:", err);
        resolveOnce(null);
      });
      
      // Feed the archive data to the stream
      const readable = Readable.from(Buffer.from(archiveData));
      readable.on("error", (err) => {
        console.error("Error reading CBZ data stream:", err);
        stream.destroy(err);
        resolveOnce(null);
      });
      readable.pipe(stream);
    });
  } catch (error) {
    console.error("Error extracting cover from CBZ:", error);
    return null;
  }
}

/**
 * Extracts and caches a cover from a downloaded issue's CBZ file.
 * Downloads the issue from Mylar, extracts the first page, and caches it.
 *
 * @param issueId The ComicVine issue ID
 * @returns Result object with success/failure and reason
 */
export async function extractCoverFromDownloadedIssue(
  issueId: string
): Promise<CoverCacheResult> {
  // Check if already cached
  if (await coverExists(issueId)) {
    return { success: true, url: getCoverUrl(issueId), source: "cached" };
  }

  // Download the archive from Mylar
  console.info(`Downloading issue ${issueId} from Mylar for cover extraction...`);
  const archiveData = await mylarDownloadIssue(issueId);
  
  if (!archiveData) {
    return {
      success: false,
      reason: "Failed to download issue from Mylar (not downloaded or not found)",
    };
  }

  // Check if it's a CBR (RAR) - not supported
  const archiveType = detectArchiveType(archiveData);
  if (archiveType === "rar") {
    return {
      success: false,
      reason: "Issue is CBR format (RAR) - extraction not supported, will use ComicVine cover",
    };
  }

  // Extract the cover
  const coverData = await extractCoverFromCbz(archiveData);
  
  if (!coverData) {
    return {
      success: false,
      reason: "Failed to extract cover image from CBZ archive",
    };
  }

  // Save to cache
  try {
    await saveCover(issueId, coverData);
    console.info(`Cached cover for issue ${issueId} (extracted from CBZ)`);
    return { success: true, url: getCoverUrl(issueId), source: "cbz" };
  } catch (error) {
    return {
      success: false,
      reason: `Failed to save cover to disk: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Fetches and caches the series cover art from Mylar.
 * Fallback when issue-specific cover isn't available.
 *
 * @param issueId The issue ID (used for caching)
 * @param seriesId The ComicVine series/volume ID
 * @returns Result object with success/failure and reason
 */
export async function cacheSeriesCover(
  issueId: string,
  seriesId: string
): Promise<CoverCacheResult> {
  // Check if already cached
  if (await coverExists(issueId)) {
    return { success: true, url: getCoverUrl(issueId), source: "cached" };
  }

  // Fetch series art from Mylar
  const artData = await mylarGetSeriesArt(seriesId);
  
  if (!artData) {
    return {
      success: false,
      reason: "Failed to fetch series art from Mylar",
    };
  }

  // Save to cache
  try {
    await saveCover(issueId, artData);
    console.info(`Cached cover for issue ${issueId} (from series art)`);
    return { success: true, url: getCoverUrl(issueId), source: "series-art" };
  } catch (error) {
    return {
      success: false,
      reason: `Failed to save cover to disk: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Ensures a cover is cached locally for a downloaded issue.
 * For downloaded issues, extracts from CBZ.
 * Returns null if caching fails (caller should fall back to ComicVine URL).
 *
 * @param issueId The ComicVine issue ID
 * @param seriesId Optional series ID for fallback to series cover
 * @returns The local cover URL path, or null if not available
 */
export async function ensureCoverCached(
  issueId: string,
  seriesId?: string
): Promise<string | null> {

  if (await coverExists(issueId)) {
    return getCoverUrl(issueId);
  }

  // Try to extract from CBZ
  const result = await extractCoverFromDownloadedIssue(issueId);
  if (result.success) {
    return result.url;
  }

  // Fallback to series cover if available
  if (seriesId) {
    const seriesResult = await cacheSeriesCover(issueId, seriesId);
    if (seriesResult.success) {
      return seriesResult.url;
    }
  }

  console.warn(`Failed to cache cover for issue ${issueId}: ${result.reason}`);
  return null;
}

/**
 * Returns the 1x1 transparent PNG placeholder.
 */

