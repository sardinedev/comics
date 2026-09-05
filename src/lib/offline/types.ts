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

/** Reading progress stored locally before, during, and after synchronization. */
export type OfflineProgressRecord = {
	issueId: string;
	currentPage: number;
	totalPages?: number;
	updatedAt: string;
	syncStatus: "synced" | "pending" | "failed";
	lastError?: string;
};

type OutboxRecordBase = {
	/** Client-generated id used to make replay idempotent. */
	id: string;
	/** Stable key used to replace an older pending mutation for the same target. */
	dedupeKey: string;
	createdAt: string;
	updatedAt: string;
	attempts: number;
	status: "pending" | "failed";
	nextAttemptAt?: string;
	lastError?: string;
};

/** A reading-progress write waiting to be replayed online. */
export type ProgressOutboxRecord = OutboxRecordBase & {
	kind: "progress";
	payload: {
		issueId: string;
		currentPage: number;
		totalPages: number;
		updatedAt: string;
		mutationId: string;
	};
};

/** An add-to-library write waiting to be replayed online. */
export type AddToLibraryOutboxRecord = OutboxRecordBase & {
	kind: "add-to-library";
	payload: {
		seriesId: string;
	};
};

/** A server mutation waiting for the next online foreground session. */
export type OfflineOutboxRecord =
	| ProgressOutboxRecord
	| AddToLibraryOutboxRecord;

/** A small piece of versioned application state used by offline orchestration. */
export type OfflineStateRecord<T = unknown> = {
	key: string;
	value: T;
	updatedAt: string;
};
