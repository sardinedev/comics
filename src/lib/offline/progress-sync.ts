import { $offline, flagIfSessionExpired } from "@stores/offline.store";
import { isOfflineStorageSupported, offlineProgress } from "./database";
import type { OfflineProgressRecord } from "./types";

const SYNC_LOCK = "comics-progress-sync";
const REQUEST_TIMEOUT_MS = 15_000;
const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type SaveReadingProgressInput = {
	issueId: string;
	currentPage: number;
	totalPages: number;
};

type PushOutcome = "settled" | "retry" | "offline" | "auth-required";

let activeSync: Promise<void> | undefined;
let syncAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempts = 0;

function validateProgress(input: SaveReadingProgressInput): void {
	if (!input.issueId.trim()) throw new Error("issueId is required");
	if (!Number.isInteger(input.currentPage) || input.currentPage < 1) {
		throw new Error("currentPage must be a positive integer");
	}
	if (!Number.isInteger(input.totalPages) || input.totalPages < 1) {
		throw new Error("totalPages must be a positive integer");
	}
	if (input.currentPage > input.totalPages) {
		throw new Error("currentPage cannot exceed totalPages");
	}
}

/**
 * Saves progress locally as pending, then syncs it straight away. The newest
 * local save always wins locally; the server settles conflicts between devices.
 */
export async function saveReadingProgress(
	input: SaveReadingProgressInput,
	now = new Date(),
): Promise<OfflineProgressRecord> {
	validateProgress(input);
	const progress: OfflineProgressRecord = {
		issueId: input.issueId,
		currentPage: input.currentPage,
		totalPages: input.totalPages,
		updatedAt: now.toISOString(),
		syncStatus: "pending",
	};
	await offlineProgress.put(progress);
	// While the server is failing, leave the save to the scheduled retry
	// instead of pushing every pending record on each page turn.
	if (retryTimer === undefined) void syncPendingProgress();
	else void refreshProgressCounts().catch(() => undefined);
	return progress;
}

/**
 * 408 and 429 are transient. A bare 401/403 is too: only a confirmed
 * auth-invalid response means the session expired.
 */
export function isPermanentFailureStatus(status: number): boolean {
	return (
		status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)
	);
}

function parseSavedProgress(
	body: unknown,
): { currentPage: number; updatedAt: string } | null {
	if (!body || typeof body !== "object") return null;
	const { current_page, updated_at } = body as {
		current_page?: unknown;
		updated_at?: unknown;
	};
	if (
		typeof current_page !== "number" ||
		!Number.isInteger(current_page) ||
		current_page < 1 ||
		typeof updated_at !== "string" ||
		Number.isNaN(Date.parse(updated_at))
	) {
		return null;
	}
	return {
		currentPage: current_page,
		updatedAt: new Date(updated_at).toISOString(),
	};
}

/** Matches only the exact save that was pushed, not a newer one since. */
function isSameSave(record: OfflineProgressRecord) {
	return (current: OfflineProgressRecord) =>
		current.updatedAt === record.updatedAt &&
		current.currentPage === record.currentPage;
}

async function pushProgress(
	record: OfflineProgressRecord,
): Promise<PushOutcome> {
	let response: Response;
	try {
		response = await fetch(
			`/api/comic/${encodeURIComponent(record.issueId)}/progress`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					current_page: record.currentPage,
					total_pages: record.totalPages,
					updated_at: record.updatedAt,
				}),
				// Lets the request finish when the reader navigates away mid-sync.
				keepalive: true,
				// A stalled request would otherwise hold the sync lock for every tab.
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch {
		return "offline";
	}

	if (flagIfSessionExpired(response)) return "auth-required";

	if (response.ok) {
		// The server answers with what it stored: our write, or a newer one
		// from another device. Either way that becomes the synced local value.
		const saved = parseSavedProgress(await response.json().catch(() => null));
		if (!saved) return "retry";
		await offlineProgress.updateIfCurrent(record.issueId, isSameSave(record), {
			issueId: record.issueId,
			currentPage: saved.currentPage,
			totalPages: record.totalPages,
			updatedAt: saved.updatedAt,
			syncStatus: "synced",
		});
		return "settled";
	}

	if (isPermanentFailureStatus(response.status)) {
		await offlineProgress.updateIfCurrent(record.issueId, isSameSave(record), {
			...record,
			syncStatus: "failed",
			lastError: `HTTP ${response.status}`,
		});
		return "settled";
	}
	return "retry";
}

function scheduleRetry(): void {
	if (retryTimer !== undefined) return;
	const delay = Math.min(
		INITIAL_RETRY_DELAY_MS * 2 ** retryAttempts,
		MAX_RETRY_DELAY_MS,
	);
	retryAttempts += 1;
	retryTimer = setTimeout(() => {
		retryTimer = undefined;
		void syncPendingProgress();
	}, delay);
}

function resetRetry(): void {
	clearTimeout(retryTimer);
	retryTimer = undefined;
	retryAttempts = 0;
}

async function syncOnce(): Promise<void> {
	let retry = false;
	try {
		if (navigator.onLine) {
			for (const record of await offlineProgress.getByStatus("pending")) {
				const outcome = await pushProgress(record);
				if (outcome === "retry" || outcome === "offline") retry = true;
				// Every remaining record would fail the same way.
				if (outcome === "offline" || outcome === "auth-required") break;
			}
		}
	} catch (error) {
		// Storage failed mid-pass; retry the records that were not reached.
		console.warn("[offline] Could not sync reading progress", error);
		retry = true;
	}
	await refreshProgressCounts().catch(() => undefined);
	if (retry) scheduleRetry();
	else resetRetry();
}

function withSyncLock(task: () => Promise<void>): Promise<void> {
	// One tab at a time, so two open readers never push the same record twice.
	if (navigator.locks) return navigator.locks.request(SYNC_LOCK, task);
	return task();
}

/**
 * Pushes every pending progress record to the server. Calls made while a sync
 * is running collapse into one follow-up pass. Never rejects.
 */
export function syncPendingProgress(): Promise<void> {
	if (!isOfflineStorageSupported()) return Promise.resolve();
	if (activeSync) {
		syncAgain = true;
		return activeSync;
	}
	activeSync = (async () => {
		try {
			do {
				syncAgain = false;
				await withSyncLock(syncOnce);
			} while (syncAgain);
		} catch (error) {
			console.warn("[offline] Could not sync reading progress", error);
		} finally {
			activeSync = undefined;
		}
	})();
	return activeSync;
}

/**
 * Publishes the pending and failed counts shown in the header. Always
 * notifies subscribers, so each sync pass doubles as a "progress changed" signal.
 */
export async function refreshProgressCounts(): Promise<void> {
	const [pendingProgress, failedProgress] = await Promise.all([
		offlineProgress.countByStatus("pending"),
		offlineProgress.countByStatus("failed"),
	]);
	$offline.set({ ...$offline.get(), pendingProgress, failedProgress });
}

/** Progress the server rejected, newest first, for review on /cache. */
export async function listFailedProgress(): Promise<OfflineProgressRecord[]> {
	return (await offlineProgress.getByStatus("failed")).sort((left, right) =>
		right.updatedAt.localeCompare(left.updatedAt),
	);
}

/**
 * Drops an issue's rejected progress so the server's progress applies again.
 * A newer save that is pending or synced is left alone.
 */
export async function discardFailedProgress(issueId: string): Promise<void> {
	await offlineProgress.updateIfCurrent(
		issueId,
		(current) => current.syncStatus === "failed",
		null,
	);
	await refreshProgressCounts();
}
