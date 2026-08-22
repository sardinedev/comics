import {
	COMIC_ARCHIVE_CACHE_NAME,
	LEGACY_COMIC_ARCHIVE_CACHE_NAME,
	OFFLINE_COVER_CACHE_NAME,
} from "@lib/offline/cache-names";
import { offlineComics } from "@lib/offline/database";
import type { OfflineComicRecord } from "@lib/offline/types";

/** Current Cache Storage bucket for complete offline comic bundles. */
export const COMIC_CACHE_NAME = COMIC_ARCHIVE_CACHE_NAME;

/** Previous cache bucket retained as a read/migration source. */
export const LEGACY_COMIC_CACHE_NAME = LEGACY_COMIC_ARCHIVE_CACHE_NAME;

/** Schema version for cached comic metadata sidecar responses. */
export const CACHED_COMIC_METADATA_VERSION = 2;

const MIGRATION_MARKER_URL = "/offline/comics/migrations/v1-complete";

/** Minimal server-derived reference used for true series adjacency. */
export type CachedIssueReference = {
	issueId: string;
	issueNumber: number | string;
	issueName?: string;
};

/** Metadata passed in when caching a comic issue. */
export type ComicCacheMetadataInput = {
	issueId: string;
	seriesId?: string;
	seriesName?: string;
	seriesYear?: string;
	issueNumber?: number | string;
	issueName?: string;
	issueDate?: string;
	coverUrl?: string;
	coverThumbHash?: string;
	/** Adjacent issues from the server's canonical series ordering. */
	previousIssue?: CachedIssueReference | null;
	nextIssue?: CachedIssueReference | null;
};

/** Metadata sidecar stored next to a cached CBZ archive. */
export type CachedComicMetadata = ComicCacheMetadataInput & {
	version: typeof CACHED_COMIC_METADATA_VERSION;
	issueId: string;
	seriesId: string;
	seriesName: string;
	issueNumber: number | string;
	previousIssue: CachedIssueReference | null;
	nextIssue: CachedIssueReference | null;
	sizeBytes: number;
	cachedAt: string;
	downloadUrl: string;
	/** Original cover request key stored in Cache Storage when available. */
	coverCacheKey?: string;
	/** A failed cover fetch is retried on a later bundle access/download. */
	coverState: "cached" | "pending" | "unavailable";
};

/** Browser-cache entry shown by the cache management page. */
export type CachedComic = {
	issueId: string;
	sizeBytes: number;
	downloadUrl: string;
	metadata: CachedComicMetadata | null;
};

/** Result of removing all records belonging to one offline comic bundle. */
export type CacheDeleteResult = {
	archiveDeleted: boolean;
	metadataDeleted: boolean;
	coverDeleted: boolean;
};

type LegacyCachedComicMetadata = ComicCacheMetadataInput & {
	version: 1;
	sizeBytes: number;
	cachedAt: string;
	downloadUrl: string;
};

let migrationPromise: Promise<void> | null = null;

export function getComicDownloadUrl(issueId: string): string {
	return `/api/comic/${encodeURIComponent(issueId)}/download`;
}

export function getComicMetadataUrl(issueId: string): string {
	return `/api/comic/${encodeURIComponent(issueId)}/cache-metadata`;
}

/** Same-origin request key used to serve a cached cover while offline. */
export function getCachedComicCoverUrl(issueId: string): string {
	return `/offline/comics/${encodeURIComponent(issueId)}/cover`;
}

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

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isIssueReference(value: unknown): value is CachedIssueReference {
	if (!value || typeof value !== "object") return false;
	const reference = value as Partial<CachedIssueReference>;
	return (
		isNonEmptyString(reference.issueId) &&
		(typeof reference.issueNumber === "number" ||
			isNonEmptyString(reference.issueNumber))
	);
}

/** Validates the metadata required to identify and render a downloaded issue. */
export function isValidComicCacheMetadataInput(
	input: unknown,
): input is ComicCacheMetadataInput & {
	issueId: string;
	seriesId: string;
	seriesName: string;
	issueNumber: number | string;
} {
	if (!input || typeof input !== "object") return false;
	const metadata = input as ComicCacheMetadataInput;
	return (
		isNonEmptyString(metadata.issueId) &&
		isNonEmptyString(metadata.seriesId) &&
		isNonEmptyString(metadata.seriesName) &&
		(typeof metadata.issueNumber === "number" ||
			isNonEmptyString(metadata.issueNumber)) &&
		(metadata.previousIssue == null ||
			isIssueReference(metadata.previousIssue)) &&
		(metadata.nextIssue == null || isIssueReference(metadata.nextIssue))
	);
}

function isCachedComicMetadata(
	value: unknown,
	issueId: string,
): value is CachedComicMetadata {
	if (!isValidComicCacheMetadataInput(value)) return false;
	const metadata = value as Partial<CachedComicMetadata>;
	return (
		metadata.version === CACHED_COMIC_METADATA_VERSION &&
		metadata.issueId === issueId &&
		typeof metadata.sizeBytes === "number" &&
		Number.isFinite(metadata.sizeBytes) &&
		metadata.sizeBytes >= 0 &&
		isNonEmptyString(metadata.cachedAt) &&
		metadata.downloadUrl === getComicDownloadUrl(issueId) &&
		(metadata.coverState === "cached" ||
			metadata.coverState === "pending" ||
			metadata.coverState === "unavailable")
	);
}

function buildCachedMetadata(
	input: ComicCacheMetadataInput,
	sizeBytes: number,
	coverState?: CachedComicMetadata["coverState"],
): CachedComicMetadata {
	if (!isValidComicCacheMetadataInput(input)) {
		throw new Error(
			"Comic cache metadata requires issue, series, and issue-number fields.",
		);
	}
	if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
		throw new Error("Comic archive size must be a non-negative number.");
	}

	const resolvedCoverState =
		coverState ?? (input.coverUrl ? "pending" : "unavailable");
	return {
		...input,
		version: CACHED_COMIC_METADATA_VERSION,
		issueId: input.issueId,
		seriesId: input.seriesId,
		seriesName: input.seriesName,
		issueNumber: input.issueNumber,
		previousIssue: input.previousIssue ?? null,
		nextIssue: input.nextIssue ?? null,
		sizeBytes,
		cachedAt: new Date().toISOString(),
		downloadUrl: getComicDownloadUrl(input.issueId),
		coverCacheKey: resolvedCoverState === "cached" ? input.coverUrl : undefined,
		coverState: resolvedCoverState,
	};
}

function toOfflineComicRecord(
	metadata: CachedComicMetadata,
): OfflineComicRecord {
	return {
		issueId: metadata.issueId,
		seriesId: metadata.seriesId,
		seriesName: metadata.seriesName,
		seriesYear: metadata.seriesYear,
		issueNumber: metadata.issueNumber,
		issueName: metadata.issueName,
		issueDate: metadata.issueDate,
		coverUrl: metadata.coverUrl,
		coverCacheKey: metadata.coverCacheKey,
		coverThumbHash: metadata.coverThumbHash,
		archiveCacheKey: metadata.downloadUrl,
		sizeBytes: metadata.sizeBytes,
		cachedAt: metadata.cachedAt,
		updatedAt: metadata.cachedAt,
		previousIssue: metadata.previousIssue,
		nextIssue: metadata.nextIssue,
	};
}

async function ensureOfflineComicRecord(
	metadata: CachedComicMetadata,
): Promise<OfflineComicRecord> {
	const existing = await offlineComics.get(metadata.issueId);
	if (
		existing &&
		existing.archiveCacheKey === metadata.downloadUrl &&
		existing.updatedAt === metadata.cachedAt
	) {
		return existing;
	}
	const record = toOfflineComicRecord(metadata);
	await offlineComics.put(record);
	return record;
}

async function migrateLegacyCache(target: Cache): Promise<void> {
	if (await target.match(MIGRATION_MARKER_URL)) return;

	const legacy = await caches.open(LEGACY_COMIC_CACHE_NAME);
	const requests = await legacy.keys();
	for (const request of requests) {
		const issueId = parseIssueIdFromDownloadUrl(request);
		if (!issueId || (await target.match(getComicDownloadUrl(issueId))))
			continue;

		const archive = await legacy.match(request);
		if (!archive) continue;

		const legacySidecar = await legacy.match(getComicMetadataUrl(issueId));
		let upgraded: CachedComicMetadata | null = null;
		if (legacySidecar) {
			try {
				const metadata =
					(await legacySidecar.json()) as LegacyCachedComicMetadata;
				if (
					metadata.version === 1 &&
					isValidComicCacheMetadataInput(metadata)
				) {
					upgraded = {
						...buildCachedMetadata(
							metadata,
							metadata.sizeBytes,
							metadata.coverUrl ? "pending" : "unavailable",
						),
						cachedAt: metadata.cachedAt,
					};
				}
			} catch {
				/* A sidecar-less archive remains readable through legacy fallback. */
			}
		}

		if (upgraded) {
			try {
				await target.put(
					getComicMetadataUrl(issueId),
					new Response(JSON.stringify(upgraded), {
						headers: { "Content-Type": "application/json" },
					}),
				);
				await ensureOfflineComicRecord(upgraded);
				// The archive is committed last so the migrated bundle is never partial.
				await target.put(getComicDownloadUrl(issueId), archive);
			} catch (error) {
				await Promise.allSettled([
					target.delete(getComicDownloadUrl(issueId)),
					target.delete(getComicMetadataUrl(issueId)),
					offlineComics.delete(issueId),
				]);
				throw error;
			}
			continue;
		}
		// Incomplete legacy entries remain available for reader compatibility.
		await target.put(getComicDownloadUrl(issueId), archive);
	}

	await target.put(MIGRATION_MARKER_URL, new Response("ok"));
}

/** Opens the current cache and performs the idempotent v1 migration once. */
export async function openComicCache(): Promise<Cache | null> {
	try {
		if (typeof caches === "undefined") return null;
		const cache = await caches.open(COMIC_CACHE_NAME);
		migrationPromise ??= migrateLegacyCache(cache).catch((error) => {
			migrationPromise = null;
			throw error;
		});
		await migrationPromise;
		return cache;
	} catch {
		return null;
	}
}

/** Complete bundles require both the archive and valid current metadata. */
export async function isIssueCached(issueId: string): Promise<boolean> {
	const cache = await openComicCache();
	if (!cache) return false;
	const [archive, metadata, record] = await Promise.all([
		cache.match(getComicDownloadUrl(issueId)),
		readCachedComicMetadata(issueId, cache),
		offlineComics.get(issueId),
	]);
	return Boolean(
		archive &&
			metadata &&
			record?.archiveCacheKey === metadata.downloadUrl &&
			record.updatedAt === metadata.cachedAt,
	);
}

export async function readCachedComicMetadata(
	issueId: string,
	openedCache?: Cache,
): Promise<CachedComicMetadata | null> {
	const cache = openedCache ?? (await openComicCache());
	if (!cache) return null;
	const response = await cache.match(getComicMetadataUrl(issueId));
	if (!response) return null;

	try {
		const metadata: unknown = await response.json();
		return isCachedComicMetadata(metadata, issueId) ? metadata : null;
	} catch {
		return null;
	}
}

export async function writeCachedComicMetadata(
	input: ComicCacheMetadataInput,
	sizeBytes: number,
	coverState?: CachedComicMetadata["coverState"],
): Promise<CachedComicMetadata | null> {
	const metadata = buildCachedMetadata(input, sizeBytes, coverState);
	const cache = await openComicCache();
	if (!cache) return null;
	await cache.put(
		getComicMetadataUrl(input.issueId),
		new Response(JSON.stringify(metadata), {
			headers: { "Content-Type": "application/json" },
		}),
	);
	return metadata;
}

async function cacheCover(
	metadata: CachedComicMetadata,
): Promise<CachedComicMetadata> {
	if (!metadata.coverUrl) return { ...metadata, coverState: "unavailable" };

	try {
		const response = await fetch(metadata.coverUrl);
		if (!response.ok) return { ...metadata, coverState: "pending" };
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		const coverCacheKey = getCachedComicCoverUrl(metadata.issueId);
		await coverCache.put(coverCacheKey, response);
		return {
			...metadata,
			coverCacheKey,
			coverState: "cached",
		};
	} catch {
		return { ...metadata, coverState: "pending" };
	}
}

/** Retries a previously failed optional cover write without affecting the bundle. */
export async function retryCachedComicCover(issueId: string): Promise<boolean> {
	const cache = await openComicCache();
	if (!cache) return false;
	const metadata = await readCachedComicMetadata(issueId, cache);
	if (!metadata || metadata.coverState !== "pending") {
		return metadata?.coverState === "cached";
	}

	const updated = await cacheCover(metadata);
	if (updated.coverState !== "cached") return false;
	try {
		// Keep the sidecar pending when the searchable projection cannot update,
		// so a later access can safely retry both writes.
		await offlineComics.put(toOfflineComicRecord(updated));
		await cache.put(
			getComicMetadataUrl(issueId),
			new Response(JSON.stringify(updated), {
				headers: { "Content-Type": "application/json" },
			}),
		);
		return true;
	} catch {
		return false;
	}
}

async function getCachedArchiveSize(
	cache: Cache,
	request: Request,
): Promise<number> {
	const response = await cache.match(request);
	if (!response) return 0;
	return (await response.arrayBuffer()).byteLength;
}

export async function listCachedComics(): Promise<CachedComic[]> {
	const cache = await openComicCache();
	if (!cache) return [];

	const archiveRequests = (await cache.keys())
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
			const metadata = await readCachedComicMetadata(issueId, cache);
			if (metadata) await ensureOfflineComicRecord(metadata);
			return {
				issueId,
				sizeBytes:
					metadata?.sizeBytes ?? (await getCachedArchiveSize(cache, request)),
				downloadUrl: getComicDownloadUrl(issueId),
				metadata,
			};
		}),
	);

	return comics.sort((a, b) => {
		const bySeries = (a.metadata?.seriesName ?? "").localeCompare(
			b.metadata?.seriesName ?? "",
		);
		if (bySeries !== 0) return bySeries;
		const aNumber = Number(a.metadata?.issueNumber ?? Number.MAX_SAFE_INTEGER);
		const bNumber = Number(b.metadata?.issueNumber ?? Number.MAX_SAFE_INTEGER);
		if (
			Number.isFinite(aNumber) &&
			Number.isFinite(bNumber) &&
			aNumber !== bNumber
		)
			return aNumber - bNumber;
		return a.issueId.localeCompare(b.issueId);
	});
}

export async function deleteCachedIssue(
	issueId: string,
): Promise<CacheDeleteResult> {
	const cache = await openComicCache();
	if (!cache) {
		await offlineComics.delete(issueId);
		return {
			archiveDeleted: false,
			metadataDeleted: false,
			coverDeleted: false,
		};
	}
	const metadata = await readCachedComicMetadata(issueId, cache);
	const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
	const [archiveDeleted, metadataDeleted, coverDeleted] = await Promise.all([
		cache.delete(getComicDownloadUrl(issueId)),
		cache.delete(getComicMetadataUrl(issueId)),
		metadata?.coverCacheKey
			? coverCache.delete(metadata.coverCacheKey)
			: Promise.resolve(false),
		offlineComics.delete(issueId),
	]);
	return { archiveDeleted, metadataDeleted, coverDeleted };
}

async function commitBundle(
	cache: Cache,
	cbz: Uint8Array,
	input: ComicCacheMetadataInput,
): Promise<void> {
	let metadata = buildCachedMetadata(input, cbz.byteLength);
	metadata = await cacheCover(metadata);

	let metadataWritten = false;
	try {
		await cache.put(
			getComicMetadataUrl(input.issueId),
			new Response(JSON.stringify(metadata), {
				headers: { "Content-Type": "application/json" },
			}),
		);
		metadataWritten = true;
		await offlineComics.put(toOfflineComicRecord(metadata));
		await cache.put(
			getComicDownloadUrl(input.issueId),
			new Response(
				cbz.buffer.slice(
					cbz.byteOffset,
					cbz.byteOffset + cbz.byteLength,
				) as ArrayBuffer,
				{
					headers: { "Content-Type": "application/octet-stream" },
				},
			),
		);
	} catch (error) {
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		await Promise.allSettled([
			cache.delete(getComicDownloadUrl(input.issueId)),
			metadataWritten
				? cache.delete(getComicMetadataUrl(input.issueId))
				: Promise.resolve(false),
			metadata.coverCacheKey
				? coverCache.delete(metadata.coverCacheKey)
				: Promise.resolve(false),
			offlineComics.delete(input.issueId),
		]);
		throw error;
	}
}

async function readDownloadResponse(
	response: Response,
	onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
	const contentLength = Number(response.headers.get("Content-Length") ?? 0);
	if (!response.body) {
		const cbz = new Uint8Array(await response.arrayBuffer());
		onProgress(1);
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
	return cbz;
}

/**
 * Downloads and atomically commits the required archive + metadata records.
 * Optional cover failures produce a readable bundle with a pending retry state.
 */
export async function downloadIssueToCache(
	issueId: string,
	onProgress: (ratio: number) => void,
	metadata?: ComicCacheMetadataInput,
): Promise<Uint8Array> {
	const url = getComicDownloadUrl(issueId);
	const cache = await openComicCache();
	const cached = cache ? await cache.match(url) : undefined;
	if (cached) {
		const cbz = new Uint8Array(await cached.arrayBuffer());
		const existingMetadata = cache
			? await readCachedComicMetadata(issueId, cache)
			: null;
		if (!existingMetadata && metadata && cache) {
			await commitBundle(cache, cbz, metadata);
		} else if (existingMetadata) {
			await ensureOfflineComicRecord(existingMetadata);
			if (existingMetadata.coverState === "pending") {
				void retryCachedComicCover(issueId);
			}
		}
		onProgress(1);
		return cbz;
	}

	if (!metadata || metadata.issueId !== issueId) {
		throw new Error("Validated comic metadata is required before downloading.");
	}
	// Validate before starting the potentially large archive transfer.
	buildCachedMetadata(metadata, 0);

	const response = await fetch(url);
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ??
				`Download failed (${response.status})`,
		);
	}

	const cbz = await readDownloadResponse(response, onProgress);
	if (cache) await commitBundle(cache, cbz, metadata);
	return cbz;
}
