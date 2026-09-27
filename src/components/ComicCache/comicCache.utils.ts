import { SessionExpiredError } from "@lib/offline/auth-response";
import {
	COMIC_ARCHIVE_CACHE_NAME,
	OFFLINE_COVER_CACHE_NAME,
} from "@lib/offline/cache-names";
import { offlineComics } from "@lib/offline/database";
import { requestPersistentStorage } from "@lib/offline/storage";
import type { OfflineComicRecord } from "@lib/offline/types";
import { flagIfSessionExpired } from "@stores/offline.store";

/** Current Cache Storage bucket for complete offline comic bundles. */
export const COMIC_CACHE_NAME = COMIC_ARCHIVE_CACHE_NAME;

/** Schema version for cached comic metadata sidecar responses. */
export const CACHED_COMIC_METADATA_VERSION = 2;

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

/** Result of removing all records belonging to one offline comic bundle. */
export type CacheDeleteResult = {
	archiveDeleted: boolean;
	metadataDeleted: boolean;
	coverDeleted: boolean;
};

const coverRetries = new Map<string, Promise<boolean>>();

function withComicBundleLock<Result>(
	issueId: string,
	operation: () => Promise<Result>,
): Promise<Result> {
	return navigator.locks.request(`comic-bundle:${issueId}`, operation);
}

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
		((typeof reference.issueNumber === "number" &&
			Number.isFinite(reference.issueNumber)) ||
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
		((typeof metadata.issueNumber === "number" &&
			Number.isFinite(metadata.issueNumber)) ||
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
): CachedComicMetadata {
	if (!isValidComicCacheMetadataInput(input)) {
		throw new Error(
			"Comic cache metadata requires issue, series, and issue-number fields.",
		);
	}
	if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
		throw new Error("Comic archive size must be a non-negative number.");
	}

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
		coverState: input.coverUrl ? "pending" : "unavailable",
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
	if (existing?.deletionPending) return existing;
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

/** Opens the Cache Storage bucket for offline comic bundles. */
export async function openComicCache(): Promise<Cache | null> {
	try {
		if (typeof caches === "undefined") return null;
		return await caches.open(COMIC_CACHE_NAME);
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
			!record?.deletionPending &&
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

async function updateCachedComicCover(issueId: string): Promise<boolean> {
	const cache = await openComicCache();
	if (!cache) return false;
	const metadata = await readCachedComicMetadata(issueId, cache);
	if (!metadata || !(await isIssueCached(issueId))) return false;
	if (metadata.coverState !== "pending" || !metadata.coverUrl) {
		return metadata.coverState === "cached";
	}

	const coverUrl = metadata.coverUrl;
	const response = await fetch(coverUrl, {
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) return false;
	const coverBytes = await response.blob();
	return withComicBundleLock(issueId, async () => {
		const current = await readCachedComicMetadata(issueId, cache);
		if (
			!current ||
			current.cachedAt !== metadata.cachedAt ||
			!(await isIssueCached(issueId))
		)
			return false;
		if (current.coverState === "cached") return true;
		const coverCache = await caches.open(OFFLINE_COVER_CACHE_NAME);
		const coverCacheKey = getCachedComicCoverUrl(issueId);
		const headers = new Headers(response.headers);
		headers.set(
			"x-comics-cover-url",
			new URL(coverUrl, globalThis.location.origin).href,
		);
		await coverCache.put(
			coverCacheKey,
			new Response(coverBytes, {
				headers,
				status: response.status,
				statusText: response.statusText,
			}),
		);
		const updated: CachedComicMetadata = {
			...current,
			coverCacheKey,
			coverState: "cached",
		};
		await offlineComics.put(toOfflineComicRecord(updated));
		await cache.put(
			getComicMetadataUrl(issueId),
			new Response(JSON.stringify(updated), {
				headers: { "Content-Type": "application/json" },
			}),
		);
		return true;
	});
}

/** Retries a previously failed optional cover write without affecting the bundle. */
export function retryCachedComicCover(issueId: string): Promise<boolean> {
	const existing = coverRetries.get(issueId);
	if (existing) return existing;
	const retry = updateCachedComicCover(issueId)
		.catch(() => false)
		.finally(() => coverRetries.delete(issueId));
	coverRetries.set(issueId, retry);
	return retry;
}

export async function deleteCachedIssue(
	issueId: string,
): Promise<CacheDeleteResult> {
	return withComicBundleLock(issueId, async () => {
		const cache = await openComicCache();
		if (!cache) throw new Error("Comic cache unavailable");
		const metadata = await readCachedComicMetadata(issueId, cache);
		const existingRecord = await offlineComics.get(issueId);
		const cleanupRecord =
			existingRecord ?? (metadata ? toOfflineComicRecord(metadata) : undefined);
		if (cleanupRecord) {
			await offlineComics.put({ ...cleanupRecord, deletionPending: true });
		}
		const results = await Promise.allSettled([
			cache.delete(getComicDownloadUrl(issueId)),
			cache.delete(getComicMetadataUrl(issueId)),
			caches
				.open(OFFLINE_COVER_CACHE_NAME)
				.then((coverCache) =>
					coverCache.delete(
						metadata?.coverCacheKey ??
							cleanupRecord?.coverCacheKey ??
							getCachedComicCoverUrl(issueId),
					),
				),
		]);
		const failures = results.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (!failures.length) {
			try {
				await offlineComics.delete(issueId);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length)
			throw new AggregateError(
				failures,
				"Comic bundle could not be completely deleted",
			);
		const [archive, metadataResult, cover] = results;
		return {
			archiveDeleted: archive.status === "fulfilled" && archive.value,
			metadataDeleted:
				metadataResult.status === "fulfilled" && metadataResult.value,
			coverDeleted: cover.status === "fulfilled" && cover.value,
		};
	});
}

async function commitBundle(
	cache: Cache,
	cbz: Uint8Array,
	input: ComicCacheMetadataInput,
): Promise<Uint8Array> {
	const committedBytes = await withComicBundleLock(input.issueId, async () => {
		const [existingArchive, existingSidecar, existingRecord] =
			await Promise.all([
				cache.match(getComicDownloadUrl(input.issueId)),
				cache.match(getComicMetadataUrl(input.issueId)),
				offlineComics.get(input.issueId),
			]);
		if (existingRecord?.deletionPending) {
			throw new Error(
				"Comic deletion is pending. Retry deletion before downloading.",
			);
		}
		const existingMetadata = existingArchive
			? await readCachedComicMetadata(input.issueId, cache)
			: null;
		if (existingArchive && existingMetadata) {
			await ensureOfflineComicRecord(existingMetadata);
			return new Uint8Array(await existingArchive.arrayBuffer());
		}
		const metadata = buildCachedMetadata(input, cbz.byteLength);

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
			await Promise.allSettled([
				cache.delete(getComicDownloadUrl(input.issueId)),
				metadataWritten
					? existingSidecar
						? cache.put(getComicMetadataUrl(input.issueId), existingSidecar)
						: cache.delete(getComicMetadataUrl(input.issueId))
					: Promise.resolve(false),
				existingRecord
					? offlineComics.put(existingRecord)
					: offlineComics.delete(input.issueId),
			]);
			throw error;
		}
		return cbz;
	});
	if (input.coverUrl) void retryCachedComicCover(input.issueId);
	return committedBytes;
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
 * Commits the bundle, then asks the browser to keep it. When `onSaveError` is
 * given, a failed save is reported there and the downloaded bytes are
 * returned anyway; otherwise the error is rethrown.
 */
async function saveForOffline(
	cache: Cache,
	cbz: Uint8Array,
	metadata: ComicCacheMetadataInput,
	{ onSaveError }: DownloadIssueOptions,
): Promise<Uint8Array> {
	try {
		const committed = await commitBundle(cache, cbz, metadata);
		void requestPersistentStorage().catch(() => false);
		return committed;
	} catch (error) {
		if (!onSaveError) throw error;
		console.warn("[offline] Could not save comic for offline reading", error);
		onSaveError(error);
		return cbz;
	}
}

export type DownloadIssueOptions = {
	/**
	 * Receives a failed save (for example, storage is full) instead of the
	 * download rejecting. The reader uses this so reading never depends on
	 * saving.
	 */
	onSaveError?: (error: unknown) => void;
};

/**
 * Downloads and atomically commits the required archive + metadata records.
 * Optional cover failures produce a readable bundle with a pending retry state.
 */
export async function downloadIssueToCache(
	issueId: string,
	onProgress: (ratio: number) => void,
	metadata?: ComicCacheMetadataInput,
	options: DownloadIssueOptions = {},
): Promise<Uint8Array> {
	const url = getComicDownloadUrl(issueId);
	const cache = await openComicCache();
	if (cache && (await offlineComics.get(issueId))?.deletionPending) {
		throw new Error(
			"Comic deletion is pending. Retry deletion before downloading.",
		);
	}
	const [cached, existingMetadata] = cache
		? await Promise.all([
				cache.match(url),
				readCachedComicMetadata(issueId, cache),
			])
		: [undefined, null];
	if (cached && existingMetadata) {
		await ensureOfflineComicRecord(existingMetadata);
		if (existingMetadata.coverState === "pending") {
			void retryCachedComicCover(issueId);
		}
		onProgress(1);
		return new Uint8Array(await cached.arrayBuffer());
	}

	if (!metadata || metadata.issueId !== issueId) {
		throw new Error("Validated comic metadata is required before downloading.");
	}
	// Validate before starting the potentially large archive transfer.
	buildCachedMetadata(metadata, 0);

	const response = await fetch(url);
	if (flagIfSessionExpired(response)) {
		throw new SessionExpiredError(
			"Your session has expired. Sign in again to download.",
		);
	}
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ??
				`Download failed (${response.status})`,
		);
	}

	const cbz = await readDownloadResponse(response, onProgress);
	if (!cache) return cbz;
	return saveForOffline(cache, cbz, metadata, options);
}
