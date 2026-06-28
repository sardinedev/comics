/** Cache Storage bucket used for downloaded CBZ archives and metadata sidecars. */
export const COMIC_CACHE_NAME = "comic-reader-v1";

/** Schema version for cached comic metadata sidecar responses. */
export const CACHED_COMIC_METADATA_VERSION = 1;

/** Cached reading state copied from the issue document when available. */
export type CachedComicReadingState = "unread" | "reading" | "read";

/**
 * Metadata passed in when caching a comic issue.
 *
 * These fields are copied from Elasticsearch while the issue is already being
 * rendered or downloaded so cache-management UI can avoid extra API lookups.
 */
export type ComicCacheMetadataInput = {
	/** Stable issue id used by local cache keys and issue links. */
	issueId: string;
	/** Stable series id for grouping or linking back to the source series. */
	seriesId?: string;
	/** Human-readable series title displayed in cache lists and progress UI. */
	seriesName?: string;
	/** Series start year displayed as secondary issue metadata. */
	seriesYear?: string;
	/** Series publisher displayed on offline issue details when available. */
	seriesPublisher?: string;
	/** Publisher issue number; may be numeric or a formatted string. */
	issueNumber?: number | string;
	/** Optional issue title displayed alongside the series and issue number. */
	issueName?: string;
	/** Optional issue description shown on the lightweight offline detail page. */
	issueDescription?: string;
	/** Issue publication date as stored in Elasticsearch. */
	issueDate?: string;
	/** Cover image URL used by the cache manager preview. */
	coverUrl?: string;
	/** ThumbHash placeholder for the issue cover, when available. */
	coverThumbHash?: string;
	/** Total issue page count from Elasticsearch or the reader progress API. */
	issuePageCount?: number;
	/** Current one-based page number for offline resume labels. */
	currentPage?: number;
	/** Reading state copied from Elasticsearch when the archive is cached. */
	readingState?: CachedComicReadingState;
	/** Creators copied from Elasticsearch for lightweight offline details. */
	writers?: string[];
	/** Artists copied from Elasticsearch for lightweight offline details. */
	artists?: string[];
	/** Colorists copied from Elasticsearch for lightweight offline details. */
	colorists?: string[];
	/** Letterers copied from Elasticsearch for lightweight offline details. */
	letterers?: string[];
	/** Cover artists copied from Elasticsearch for lightweight offline details. */
	coverArtists?: string[];
	/** Editors copied from Elasticsearch for lightweight offline details. */
	editors?: string[];
};

/** Metadata sidecar stored next to a cached CBZ archive. */
export type CachedComicMetadata = ComicCacheMetadataInput & {
	/** Sidecar schema version used to reject stale or incompatible metadata. */
	version: typeof CACHED_COMIC_METADATA_VERSION;
	/** Cached CBZ archive size in bytes. */
	sizeBytes: number;
	/** ISO timestamp for when the archive metadata was written. */
	cachedAt: string;
	/** Cache key URL for the archived CBZ download response. */
	downloadUrl: string;
};

/** Browser-cache entry shown by the cache management page. */
export type CachedComic = {
	/** Stable issue id parsed from the cached download URL. */
	issueId: string;
	/** Cached archive size in bytes, from metadata or measured from the archive. */
	sizeBytes: number;
	/** Cache key URL for the archived CBZ download response. */
	downloadUrl: string;
	/** Metadata sidecar when present; null for sidecar-less legacy cache entries. */
	metadata: CachedComicMetadata | null;
};

/** Result of removing an issue's archive and metadata sidecar from Cache Storage. */
export type CacheDeleteResult = {
	/** Whether the cached CBZ archive response was removed. */
	archiveDeleted: boolean;
	/** Whether the cached metadata sidecar response was removed. */
	metadataDeleted: boolean;
};

/**
 * Builds the Cache Storage key and API route for an issue's CBZ archive.
 *
 * @param issueId - Issue id to encode into the download URL.
 * @returns The relative download URL used as the archive cache key.
 */
export function getComicDownloadUrl(issueId: string): string {
	return `/api/comic/${encodeURIComponent(issueId)}/download`;
}

/**
 * Builds the Cache Storage key for an issue's metadata sidecar.
 *
 * @param issueId - Issue id to encode into the metadata URL.
 * @returns The relative sidecar URL used as the metadata cache key.
 */
export function getComicMetadataUrl(issueId: string): string {
	return `/api/comic/${encodeURIComponent(issueId)}/cache-metadata`;
}

/**
 * Builds the issue-detail URL for a cached issue.
 *
 * @param issueId - Issue id to encode into the detail URL.
 * @returns The relative issue-detail URL.
 */
export function getComicUrl(issueId: string): string {
	return `/comic/${encodeURIComponent(issueId)}`;
}

/**
 * Builds the reader URL for a cached issue.
 *
 * @param issueId - Issue id to encode into the reader URL.
 * @returns The relative reader URL.
 */
export function getComicReaderUrl(issueId: string): string {
	return `/comic/${encodeURIComponent(issueId)}/read`;
}

/**
 * Extracts an issue id from a cached archive request.
 *
 * Only archive download keys match; metadata sidecar keys intentionally return
 * null so cache listings do not duplicate an issue.
 *
 * @param input - Cached request or URL string to inspect.
 * @returns The decoded issue id, or null when the URL is not an archive key.
 */
export function parseIssueIdFromDownloadUrl(
	input: string | Request,
): string | null {
	const rawUrl = typeof input === "string" ? input : input.url;

	try {
		const url = new URL(
			rawUrl,
			globalThis.location?.origin ?? "http://localhost",
		);
		const match = url.pathname.match(/^\/api\/comic\/([^/]+)\/download$/);
		return match ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
}

/**
 * Opens the browser Cache Storage bucket for comic archives.
 *
 * @returns The cache bucket, or null when Cache Storage is unavailable.
 */
export async function openComicCache(): Promise<Cache | null> {
	try {
		if (typeof caches !== "undefined")
			return await caches.open(COMIC_CACHE_NAME);
	} catch {
		/* Cache API unavailable (HTTP, older browser, quota/state issue). */
	}
	return null;
}

/**
 * Checks whether an issue archive is already cached in this browser.
 *
 * @param issueId - Issue id to look up in Cache Storage.
 * @returns True when the archive download response exists in the comic cache.
 */
export async function isIssueCached(issueId: string): Promise<boolean> {
	const cache = await openComicCache();
	if (!cache) return false;
	return Boolean(await cache.match(getComicDownloadUrl(issueId)));
}

/**
 * Reads and validates the metadata sidecar for a cached issue.
 *
 * @param issueId - Issue id whose sidecar should be read.
 * @returns Valid cached metadata, or null when absent, stale, or malformed.
 */
export async function readCachedComicMetadata(
	issueId: string,
): Promise<CachedComicMetadata | null> {
	const cache = await openComicCache();
	if (!cache) return null;

	const response = await cache.match(getComicMetadataUrl(issueId));
	if (!response) return null;

	try {
		const metadata = (await response.json()) as CachedComicMetadata;
		if (metadata.version !== CACHED_COMIC_METADATA_VERSION) return null;
		if (metadata.issueId !== issueId) return null;
		if (typeof metadata.sizeBytes !== "number") return null;
		return metadata;
	} catch {
		return null;
	}
}

/**
 * Writes metadata for a cached issue archive.
 *
 * @param input - Issue metadata to persist beside the archive.
 * @param sizeBytes - Size of the cached archive in bytes.
 * @returns The metadata object that was written, or null when cache is unavailable.
 */
export async function writeCachedComicMetadata(
	input: ComicCacheMetadataInput,
	sizeBytes: number,
): Promise<CachedComicMetadata | null> {
	const cache = await openComicCache();
	if (!cache) return null;

	const metadata: CachedComicMetadata = {
		...input,
		version: CACHED_COMIC_METADATA_VERSION,
		issueId: input.issueId,
		sizeBytes,
		cachedAt: new Date().toISOString(),
		downloadUrl: getComicDownloadUrl(input.issueId),
	};

	await cache.put(
		getComicMetadataUrl(input.issueId),
		new Response(JSON.stringify(metadata), {
			headers: { "Content-Type": "application/json" },
		}),
	);

	return metadata;
}

/**
 * Writes cache metadata without letting sidecar failures block archive caching.
 *
 * @param input - Optional issue metadata to persist.
 * @param sizeBytes - Size of the cached archive in bytes.
 */
async function writeCachedComicMetadataSafely(
	input: ComicCacheMetadataInput | undefined,
	sizeBytes: number,
): Promise<void> {
	if (!input) return;
	try {
		await writeCachedComicMetadata(input, sizeBytes);
	} catch {
		/* Metadata sidecars are useful, but should not block reading. */
	}
}

/**
 * Measures a cached archive response by reading its body.
 *
 * @param cache - Cache bucket containing the archive response.
 * @param request - Archive request key to measure.
 * @returns Archive size in bytes, or 0 when the response is missing.
 */
async function getCachedArchiveSize(
	cache: Cache,
	request: Request,
): Promise<number> {
	const response = await cache.match(request);
	if (!response) return 0;
	const buffer = await response.arrayBuffer();
	return buffer.byteLength;
}

/**
 * Lists every comic archive cached in this browser.
 *
 * Sidecar-less archives are included with null metadata and their size measured
 * directly from the cached archive response.
 *
 * @returns Cached comics sorted by series, issue number, and issue id.
 */
export async function listCachedComics(): Promise<CachedComic[]> {
	const cache = await openComicCache();
	if (!cache) return [];

	const requests = await cache.keys();
	const archiveRequests = requests
		.map((request) => ({
			request,
			issueId: parseIssueIdFromDownloadUrl(request),
		}))
		.filter(
			(entry): entry is { request: Request; issueId: string } =>
				entry.issueId !== null,
		);

	const comics = await Promise.all(
		archiveRequests.map(async ({ request, issueId }) => {
			const metadata = await readCachedComicMetadata(issueId);
			const sizeBytes =
				metadata?.sizeBytes ?? (await getCachedArchiveSize(cache, request));
			return {
				issueId,
				sizeBytes,
				downloadUrl: getComicDownloadUrl(issueId),
				metadata,
			};
		}),
	);

	return comics.sort((a, b) => {
		const aSeries = a.metadata?.seriesName ?? "";
		const bSeries = b.metadata?.seriesName ?? "";
		const bySeries = aSeries.localeCompare(bSeries);
		if (bySeries !== 0) return bySeries;
		const aNumber = Number(a.metadata?.issueNumber ?? Number.MAX_SAFE_INTEGER);
		const bNumber = Number(b.metadata?.issueNumber ?? Number.MAX_SAFE_INTEGER);
		if (
			Number.isFinite(aNumber) &&
			Number.isFinite(bNumber) &&
			aNumber !== bNumber
		) {
			return aNumber - bNumber;
		}
		return a.issueId.localeCompare(b.issueId);
	});
}

/**
 * Deletes an issue's cached archive and metadata sidecar.
 *
 * @param issueId - Issue id to remove from Cache Storage.
 * @returns Flags indicating which cache entries were deleted.
 */
export async function deleteCachedIssue(
	issueId: string,
): Promise<CacheDeleteResult> {
	const cache = await openComicCache();
	if (!cache) return { archiveDeleted: false, metadataDeleted: false };

	const [archiveDeleted, metadataDeleted] = await Promise.all([
		cache.delete(getComicDownloadUrl(issueId)),
		cache.delete(getComicMetadataUrl(issueId)),
	]);

	return { archiveDeleted, metadataDeleted };
}

/**
 * Downloads an issue archive and stores it in the browser comic cache.
 *
 * Cache hits return the stored archive without a network request. Cache misses
 * stream progress when possible, store the archive response, and write metadata
 * as a best-effort sidecar.
 *
 * @param issueId - Issue id used to build the archive download URL.
 * @param onProgress - Called with a ratio in `[0, 1]` as bytes are received.
 * @param metadata - Optional metadata sidecar to write after caching the archive.
 * @returns The full CBZ archive bytes.
 * @throws If the download response is not OK or the response body cannot be read.
 */
export async function downloadIssueToCache(
	issueId: string,
	onProgress: (ratio: number) => void,
	metadata?: ComicCacheMetadataInput,
): Promise<Uint8Array> {
	const url = getComicDownloadUrl(issueId);
	const cache = await openComicCache();

	if (cache) {
		const cached = await cache.match(url);
		if (cached) {
			const buffer = await cached.arrayBuffer();
			onProgress(1);
			return new Uint8Array(buffer);
		}
	}

	const response = await fetch(url);
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ??
			`Download failed (${response.status})`,
		);
	}

	const contentLength = Number(response.headers.get("Content-Length") ?? 0);

	if (!response.body) {
		const buffer = await response.arrayBuffer();
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
		await writeCachedComicMetadataSafely(metadata, cbz.byteLength);
		return cbz;
	}

	const chunks: Uint8Array[] = [];
	let received = 0;

	const reader = response.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		if (contentLength > 0) onProgress(received / contentLength);
	}

	const cbz = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		cbz.set(chunk, offset);
		offset += chunk.length;
	}

	if (cache) {
		await cache.put(
			url,
			new Response(cbz, {
				headers: { "Content-Type": "application/octet-stream" },
			}),
		);
	}
	await writeCachedComicMetadataSafely(metadata, cbz.byteLength);

	return cbz;
}
