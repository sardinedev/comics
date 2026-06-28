/** LocalStorage key for per-issue reader progress saved by this browser. */
export const READER_PROGRESS_STORAGE_KEY = "comic-reader-progress-v1";

/** Locally persisted reader progress for one issue. */
export type ReaderProgress = {
	/** Stable issue id for the saved progress entry. */
	issueId: string;
	/** One-based current page number. */
	currentPage: number;
	/** Total extracted pages reported by the reader. */
	totalPages: number;
	/** ISO timestamp for the newest local progress write. */
	updatedAt: string;
	/** ISO timestamp for the newest successful server sync, when known. */
	syncedAt?: string;
};

type ReaderProgressMap = Record<string, ReaderProgress>;

function getStorage(): Storage | null {
	try {
		if (typeof localStorage !== "undefined") return localStorage;
	} catch {
		/* localStorage can be blocked by browser settings or private contexts. */
	}
	return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTime(value: string | undefined): number {
	if (!value) return 0;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : 0;
}

function parseProgress(value: unknown): ReaderProgress | null {
	if (!isObject(value)) return null;

	const { issueId, currentPage, totalPages, updatedAt, syncedAt } = value;
	if (typeof issueId !== "string" || issueId.length === 0) return null;
	if (typeof currentPage !== "number" || !Number.isInteger(currentPage))
		return null;
	if (currentPage < 1) return null;
	if (typeof totalPages !== "number" || !Number.isInteger(totalPages))
		return null;
	if (totalPages < 1) return null;
	if (typeof updatedAt !== "string" || toTime(updatedAt) === 0) return null;
	if (syncedAt !== undefined && typeof syncedAt !== "string") return null;

	return {
		issueId,
		currentPage,
		totalPages,
		updatedAt,
		...(syncedAt ? { syncedAt } : {}),
	};
}

function readProgressMap(): ReaderProgressMap {
	const storage = getStorage();
	if (!storage) return {};

	try {
		const raw = storage.getItem(READER_PROGRESS_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!isObject(parsed)) return {};

		const progress: ReaderProgressMap = {};
		for (const value of Object.values(parsed)) {
			const entry = parseProgress(value);
			if (entry) progress[entry.issueId] = entry;
		}
		return progress;
	} catch {
		return {};
	}
}

function writeProgressMap(progress: ReaderProgressMap): boolean {
	const storage = getStorage();
	if (!storage) return false;

	try {
		storage.setItem(READER_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
		return true;
	} catch {
		return false;
	}
}

/** Returns every valid local progress entry saved by this browser. */
export function listReaderProgress(): ReaderProgress[] {
	return Object.values(readProgressMap());
}

/** Returns the local progress entry for an issue, when one exists. */
export function readReaderProgress(issueId: string): ReaderProgress | null {
	return readProgressMap()[issueId] ?? null;
}

/** Returns true when a progress entry has been synced after its latest write. */
export function isReaderProgressSynced(progress: ReaderProgress): boolean {
	return toTime(progress.syncedAt) >= toTime(progress.updatedAt);
}

/** Returns progress entries that still need to be synced to the server. */
export function listUnsyncedReaderProgress(): ReaderProgress[] {
	return listReaderProgress().filter(
		(progress) => !isReaderProgressSynced(progress),
	);
}

/** Saves one-based reader progress locally and marks changed progress unsynced. */
export function saveReaderProgress(
	issueId: string,
	currentPage: number,
	totalPages: number,
	options: { updatedAt?: string; syncedAt?: string } = {},
): ReaderProgress | null {
	if (!issueId) return null;
	if (!Number.isInteger(currentPage) || currentPage < 1) return null;
	if (!Number.isInteger(totalPages) || totalPages < 1) return null;

	const progress = readProgressMap();
	const existing = progress[issueId];
	const resolvedTotalPages = Math.max(totalPages, currentPage);
	const isSameProgress =
		existing?.currentPage === currentPage &&
		existing.totalPages === resolvedTotalPages;
	const entry: ReaderProgress = {
		issueId,
		currentPage,
		totalPages: resolvedTotalPages,
		updatedAt: isSameProgress
			? existing.updatedAt
			: (options.updatedAt ?? new Date().toISOString()),
		...(options.syncedAt
			? { syncedAt: options.syncedAt }
			: isSameProgress && existing.syncedAt
				? { syncedAt: existing.syncedAt }
				: {}),
	};

	progress[issueId] = entry;
	return writeProgressMap(progress) ? entry : null;
}

/** Marks an existing progress entry as successfully synced to the server. */
export function markReaderProgressSynced(
	issueId: string,
	syncedAt = new Date().toISOString(),
): ReaderProgress | null {
	const progress = readProgressMap();
	const entry = progress[issueId];
	if (!entry) return null;

	const syncedEntry = { ...entry, syncedAt };
	progress[issueId] = syncedEntry;
	return writeProgressMap(progress) ? syncedEntry : null;
}

/** Removes local progress for an issue. */
export function deleteReaderProgress(issueId: string): boolean {
	const progress = readProgressMap();
	if (!progress[issueId]) return true;
	delete progress[issueId];
	return writeProgressMap(progress);
}

/** Chooses the one-based page the reader should open on for this browser. */
export function resolveInitialReaderPage(
	issueId: string,
	serverInitialPage: number,
	options: { preferStored?: boolean } = {},
): number {
	const progress = readReaderProgress(issueId);
	const normalizedServerPage =
		Number.isInteger(serverInitialPage) && serverInitialPage > 0
			? serverInitialPage
			: 1;
	if (!progress) return normalizedServerPage;
	if (options.preferStored) return progress.currentPage;
	if (serverInitialPage < 1) return progress.currentPage;
	if (isReaderProgressSynced(progress)) return serverInitialPage;
	return progress.currentPage;
}

/** Attempts to sync one local progress entry to the existing progress API. */
export async function syncReaderProgress(issueId: string): Promise<boolean> {
	const progress = readReaderProgress(issueId);
	if (!progress || isReaderProgressSynced(progress)) return true;
	if (typeof fetch === "undefined") return false;
	if (typeof navigator !== "undefined" && navigator.onLine === false)
		return false;

	try {
		const response = await fetch(
			`/api/comic/${encodeURIComponent(issueId)}/progress`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					current_page: progress.currentPage,
					total_pages: progress.totalPages,
				}),
			},
		);
		if (!response.ok) return false;
		markReaderProgressSynced(issueId);
		return true;
	} catch {
		return false;
	}
}

/** Attempts to sync all unsynced progress entries saved in this browser. */
export async function syncPendingReaderProgress(): Promise<number> {
	let syncedCount = 0;
	for (const progress of listUnsyncedReaderProgress()) {
		if (await syncReaderProgress(progress.issueId)) syncedCount += 1;
	}
	return syncedCount;
}
