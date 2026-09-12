import {
	getComicDownloadUrl,
	openComicCache,
	readCachedComicMetadata,
} from "@components/ComicCache/comicCache.utils";
import { offlineComics, offlineProgress } from "@lib/offline/database";
import type { OfflineProgressRecord } from "@lib/offline/types";
import type { ComicReaderProps, NextIssueSummary } from "./comicReader.types";

export const OFFLINE_READER_ERROR =
	"This comic isn’t available offline or its saved copy is incomplete.";

export type OfflineReaderBootstrap = Pick<
	ComicReaderProps,
	"issueId" | "initialPage" | "cacheMetadata" | "offlineMode"
> & {
	nextIssue?: NextIssueSummary;
	hasUndownloadedNextIssue: boolean;
};

/** Extracts an issue id without changing the normal reader URL. */
export function parseComicReaderIssueId(pathname: string): string | null {
	const match = pathname.match(/^\/comic\/([^/]+)\/read\/?$/);
	if (!match) return null;
	try {
		const issueId = decodeURIComponent(match[1]);
		return issueId.trim() ? issueId : null;
	} catch {
		return null;
	}
}

function isUsableProgress(
	record: OfflineProgressRecord | undefined,
): record is OfflineProgressRecord {
	return Boolean(
		record &&
			Number.isInteger(record.currentPage) &&
			record.currentPage >= 1 &&
			!Number.isNaN(Date.parse(record.updatedAt)),
	);
}

/** Local progress wins when available because the server cannot be reached. */
export async function resolveReaderStartPage(
	issueId: string,
	serverPage: number,
	serverUpdatedAt?: string,
): Promise<number> {
	try {
		const local = await offlineProgress.get(issueId);
		if (isUsableProgress(local)) {
			const serverTimestamp = serverUpdatedAt
				? Date.parse(serverUpdatedAt)
				: Number.NaN;
			if (
				Number.isNaN(serverTimestamp) ||
				Date.parse(local.updatedAt) > serverTimestamp
			) {
				return local.currentPage;
			}
		}
	} catch {
		// IndexedDB may be unavailable or evicted; server progress remains usable.
	}
	return Number.isInteger(serverPage) && serverPage >= 1 ? serverPage : 1;
}

/**
 * Validates and projects the complete v2 bundle needed by the generic shell.
 * The archive is decoded by ComicReader after this lightweight presence check.
 */
export async function loadOfflineReaderBootstrap(
	pathname: string,
): Promise<OfflineReaderBootstrap> {
	const issueId = parseComicReaderIssueId(pathname);
	if (!issueId) throw new Error(OFFLINE_READER_ERROR);

	const cache = await openComicCache();
	if (!cache) throw new Error(OFFLINE_READER_ERROR);

	const [metadata, record, archive, progress] = await Promise.all([
		readCachedComicMetadata(issueId, cache),
		offlineComics.get(issueId),
		cache.match(getComicDownloadUrl(issueId)),
		offlineProgress.get(issueId).catch(() => undefined),
	]);

	if (
		!metadata ||
		!record ||
		!archive ||
		record.archiveCacheKey !== metadata.downloadUrl ||
		record.updatedAt !== metadata.cachedAt
	) {
		throw new Error(OFFLINE_READER_ERROR);
	}

	const nextReference = metadata.nextIssue;
	let nextIssue: NextIssueSummary | undefined;
	if (nextReference) {
		const [nextRecord, nextArchive, nextMetadata] = await Promise.all([
			offlineComics.get(nextReference.issueId),
			cache.match(getComicDownloadUrl(nextReference.issueId)),
			readCachedComicMetadata(nextReference.issueId, cache),
		]);
		if (
			nextRecord &&
			nextArchive &&
			nextMetadata &&
			nextRecord.archiveCacheKey === nextMetadata.downloadUrl &&
			nextRecord.updatedAt === nextMetadata.cachedAt
		) {
			nextIssue = {
				id: nextReference.issueId,
				seriesName: nextRecord.seriesName || metadata.seriesName,
				issueNumber: nextReference.issueNumber,
				issueName: nextReference.issueName,
			};
		}
	}

	return {
		issueId,
		initialPage: isUsableProgress(progress) ? progress.currentPage : 1,
		nextIssue,
		hasUndownloadedNextIssue: Boolean(nextReference && !nextIssue),
		offlineMode: true,
		cacheMetadata: metadata,
	};
}
