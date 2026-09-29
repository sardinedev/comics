/** A reference used to preserve the server's issue ordering while offline. */
export type OfflineIssueReference = {
	issueId: string;
	issueNumber: number | string;
	issueName?: string;
};

/**
 * Searchable metadata for an offline comic or a bundle awaiting deletion.
 *
 * Binary archives and covers live in Cache Storage. This record deliberately
 * contains only structured data and cache keys so it remains cheap to query.
 */
export type OfflineComicRecord = {
	issueId: string;
	seriesId: string;
	seriesName: string;
	seriesYear?: string;
	seriesPublisher?: string;
	issueNumber: number | string;
	issueName?: string;
	issueDate?: string;
	pageCount?: number;
	coverUrl?: string;
	coverCacheKey?: string;
	coverThumbHash?: string;
	archiveCacheKey: string;
	sizeBytes: number;
	cachedAt: string;
	updatedAt: string;
	deletionPending?: boolean;
	previousIssue?: OfflineIssueReference | null;
	nextIssue?: OfflineIssueReference | null;
};

/**
 * Reading progress stored locally. Records with `syncStatus: "pending"` are
 * the sync queue; `failed` records were rejected by the server.
 */
export type OfflineProgressRecord = {
	issueId: string;
	currentPage: number;
	totalPages?: number;
	updatedAt: string;
	syncStatus: "synced" | "pending" | "failed";
	lastError?: string;
};
