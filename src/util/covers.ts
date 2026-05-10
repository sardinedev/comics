import * as fs from "node:fs/promises";
import * as path from "node:path";
import { mylarDownloadIssue } from "@data/mylar/mylar";
import { env } from "@lib/env";
import { unzip } from "fflate";
import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";

const COVERS_DIR = env("COVERS_DIR") ?? "data/covers";

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
export type CoverCacheResult =
	| {
			success: true;
			url: string;
			source: "cached" | "cbz" | "series-art";
	  }
	| {
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
	if (data[0] === 0x50 && data[1] === 0x4b) {
		return "zip";
	}

	// RAR: starts with "Rar!" (0x52 0x61 0x72 0x21)
	if (
		data[0] === 0x52 &&
		data[1] === 0x61 &&
		data[2] === 0x72 &&
		data[3] === 0x21
	) {
		return "rar";
	}

	return "unknown";
}

export async function extractCoverFromCbz(
	archiveData: Uint8Array,
): Promise<Uint8Array | null> {
	// Detect archive type
	const archiveType = detectArchiveType(archiveData);

	if (archiveType === "rar") {
		// CBR (RAR) files are not supported by this ZIP-only extraction path.
		console.warn(
			`Archive is CBR (RAR format) - not supported. Size: ${(archiveData.length / 1024 / 1024).toFixed(2)} MB`,
		);
		return null;
	}

	if (archiveType === "unknown") {
		console.error(
			`Unknown archive format. First bytes: ${Array.from(
				archiveData.slice(0, 8),
			)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ")}`,
		);
		// If it looks like text, show a preview
		if (archiveData[0] < 128 && archiveData[1] < 128) {
			const textPreview = new TextDecoder().decode(archiveData.slice(0, 200));
			console.error(`Data looks like text: ${textPreview}`);
		}
		return null;
	}

	console.info(
		`Parsing CBZ (ZIP) archive: ${(archiveData.length / 1024 / 1024).toFixed(2)} MB`,
	);

	return new Promise<Uint8Array | null>((resolve) => {
		unzip(
			archiveData,
			{
				filter: (file) =>
					!file.name.startsWith("__MACOSX/") && isImageFile(file.name),
			},
			(err, entries) => {
				if (err) {
					console.error("Error extracting cover from CBZ:", err);
					resolve(null);
					return;
				}

				const sortedPaths = Object.keys(entries).sort((a, b) =>
					a.localeCompare(b),
				);
				if (sortedPaths.length === 0) {
					console.error("No image files found in CBZ archive");
					resolve(null);
					return;
				}

				const coverPath = sortedPaths[0];
				console.info(`Extracted cover: ${coverPath}`);
				resolve(entries[coverPath]);
			},
		);
	});
}

/**
 * Extracts and caches a cover from a downloaded issue's CBZ file.
 * Downloads the issue from Mylar, extracts the first page, and caches it.
 *
 * @param issueId The ComicVine issue ID
 * @returns Result object with success/failure and reason
 */
export async function extractCoverFromDownloadedIssue(
	issueId: string,
): Promise<CoverCacheResult> {
	// Check if already cached
	if (await coverExists(issueId)) {
		return { success: true, url: getCoverUrl(issueId), source: "cached" };
	}

	// Download the archive from Mylar
	console.info(
		`Downloading issue ${issueId} from Mylar for cover extraction...`,
	);
	const archiveData = await mylarDownloadIssue(issueId);

	if (!archiveData) {
		return {
			success: false,
			reason:
				"Failed to download issue from Mylar (not downloaded or not found)",
		};
	}

	// Check if it's a CBR (RAR) - not supported
	const archiveType = detectArchiveType(archiveData);
	if (archiveType === "rar") {
		return {
			success: false,
			reason:
				"Issue is CBR format (RAR) - extraction not supported, will use ComicVine cover",
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
 * Generates a ThumbHash placeholder for a cached cover image.
 * Resizes the image to fit within 100x100 (preserving aspect ratio),
 * then encodes to a compact base64 hash for use as a loading placeholder.
 *
 * @param issueId The ComicVine issue ID
 * @returns Base64 thumbhash string, or null if generation fails
 */
export async function generateThumbHash(
	issueId: string,
): Promise<string | null> {
	try {
		const filePath = getCoverFilePath(issueId);
		const { data, info } = await sharp(filePath)
			.resize(100, 100, { fit: "inside" })
			.raw()
			.ensureAlpha()
			.toBuffer({ resolveWithObject: true });

		const hash = rgbaToThumbHash(info.width, info.height, new Uint8Array(data));
		return Buffer.from(hash).toString("base64");
	} catch {
		return null;
	}
}

/**
 * Ensures a cover is cached locally for a downloaded issue.
 * For downloaded issues, extracts from CBZ.
 * Returns null if caching fails (caller should fall back to ComicVine URL).
 *
 * @param issueId The ComicVine issue ID
 * @returns The local cover URL path, or null if not available
 */
export async function ensureCoverCached(
	issueId: string,
): Promise<string | null> {
	if (await coverExists(issueId)) {
		return getCoverUrl(issueId);
	}

	// Try to extract from CBZ
	const result = await extractCoverFromDownloadedIssue(issueId);
	if (result.success) {
		return result.url;
	}

	console.warn(`Failed to cache cover for issue ${issueId}: ${result.reason}`);
	return null;
}
