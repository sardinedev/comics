import { isConfirmedAuthInvalidResponse } from "./auth-response";
import { clearOfflineData } from "./clear";
import { offlineOutbox } from "./database";
import type {
	OutboxCounts,
	OutboxHandlerResult,
	OutboxReplayEngine,
} from "./outbox";
import { getOutboxCounts } from "./outbox";
import type { AddToLibraryOutboxRecord } from "./types";

export const OUTBOX_STATUS_EVENT = "comics:outbox-status";

export type AddToLibraryRequestResult = {
	status: "added" | "pending" | "failed";
	message?: string;
};

/** Ensures equivalent series identifiers share one queued action. */
function normaliseSeriesId(seriesId: string): string {
	const normalised = seriesId.trim();
	if (!normalised) throw new Error("Series id is required");
	return normalised;
}

/** Keeps repeated requests for one series from creating duplicate queued actions. */
export function getLibraryDedupeKey(seriesId: string): string {
	return `library:${normaliseSeriesId(seriesId)}`;
}

/** Gives retries a stable identity without conflating separate user requests. */
function createMutationId(seriesId: string): string {
	return `library:${seriesId}:${crypto.randomUUID()}`;
}

/** Restores the visible pending state when a series page is revisited. */
export async function getQueuedAddToLibrary(
	seriesId: string,
): Promise<AddToLibraryOutboxRecord | undefined> {
	const record = await offlineOutbox.getByDedupeKey(
		getLibraryDedupeKey(seriesId),
	);
	return record?.kind === "add-to-library" ? record : undefined;
}

/** Queue one stable, deduplicated mutation for this series. */
export async function queueAddToLibrary(
	seriesId: string,
	now = new Date(),
): Promise<AddToLibraryOutboxRecord> {
	const normalised = normaliseSeriesId(seriesId);
	const dedupeKey = getLibraryDedupeKey(normalised);
	const existing = await offlineOutbox.getByDedupeKey(dedupeKey);
	const timestamp = now.toISOString();
	const record: AddToLibraryOutboxRecord = {
		id:
			existing?.kind === "add-to-library"
				? existing.id
				: createMutationId(normalised),
		dedupeKey,
		kind: "add-to-library",
		payload: { seriesId: normalised },
		createdAt:
			existing?.kind === "add-to-library" ? existing.createdAt : timestamp,
		updatedAt: timestamp,
		attempts: existing?.kind === "add-to-library" ? existing.attempts : 0,
		status: "pending",
	};
	await offlineOutbox.put(record);
	await publishOutboxStatus();
	return record;
}

/** Transport handler composed into the shared OutboxReplayEngine. */
export async function replayAddToLibrary(
	record: AddToLibraryOutboxRecord,
): Promise<OutboxHandlerResult> {
	const response = await fetch("/api/library/add", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			seriesId: record.payload.seriesId,
			mutationId: record.id,
		}),
	});

	if (isConfirmedAuthInvalidResponse(response, globalThis.location?.origin))
		return { status: 401, statusText: "Session expired" };

	// Older servers may use 409 for an already-added series. It is equivalent
	// to success for this idempotent resource mutation.
	if (response.status === 409) {
		const body = await response
			.clone()
			.json()
			.catch(() => undefined);
		if (
			body &&
			typeof body === "object" &&
			"code" in body &&
			(body as { code?: unknown }).code === "already-added"
		) {
			return { status: 200, statusText: "Already added" };
		}
	}

	return { status: response.status, statusText: response.statusText };
}

/** Settles a successful request without deleting a newer action for the same series. */
async function deleteQueuedMutation(
	record: AddToLibraryOutboxRecord,
): Promise<void> {
	await offlineOutbox.updateIfCurrent(record, null);
}

/** Records an outcome only while it still belongs to the queued action. */
async function updateQueuedMutation(
	record: AddToLibraryOutboxRecord,
	update: Partial<AddToLibraryOutboxRecord>,
): Promise<void> {
	await offlineOutbox.updateIfCurrent(record, { ...record, ...update });
}

/**
 * Optimistically queues, then attempts the mutation immediately when online.
 * Transient and ambiguous failures remain pending for shared-engine replay.
 */
export async function requestAddToLibrary(
	seriesId: string,
): Promise<AddToLibraryRequestResult> {
	const record = await queueAddToLibrary(seriesId);
	if (!navigator.onLine) return { status: "pending" };

	try {
		const response = await replayAddToLibrary(record);
		if (response.status >= 200 && response.status < 300) {
			await deleteQueuedMutation(record);
			await publishOutboxStatus();
			return { status: "added" };
		}
		if (response.status === 401 || response.status === 403) {
			await clearOfflineData();
			await publishOutboxStatus();
			return { status: "failed", message: "Your session has expired." };
		}
		if (response.status >= 400 && response.status < 500) {
			await updateQueuedMutation(record, {
				attempts: record.attempts + 1,
				status: "failed",
				lastError: response.statusText || `HTTP ${response.status}`,
			});
			await publishOutboxStatus();
			return { status: "failed" };
		}
		await updateQueuedMutation(record, {
			lastError: response.statusText || `HTTP ${response.status}`,
		});
		await publishOutboxStatus();
		return { status: "pending" };
	} catch (error) {
		await updateQueuedMutation(record, {
			lastError:
				error instanceof Error ? error.message : "Network request failed",
		});
		await publishOutboxStatus();
		return { status: "pending" };
	}
}

/** Keeps pending and failed work visible to users across header replacements. */
export function renderPendingActionCountElements(
	counts: OutboxCounts,
	root: ParentNode = document,
): void {
	for (const element of root.querySelectorAll<HTMLElement>(
		"[data-outbox-pending-count]",
	)) {
		element.hidden = counts.total === 0;
		element.dataset.state = counts.failed > 0 ? "failed" : "pending";
		element.textContent = String(counts.total);
		element.setAttribute(
			"aria-label",
			counts.failed > 0
				? `${counts.pending} pending actions, ${counts.failed} failed actions`
				: `${counts.pending} pending actions`,
		);
	}
}

/** Keeps library controls and the header consistent with the durable queue. */
export async function publishOutboxStatus(): Promise<OutboxCounts> {
	const counts = await getOutboxCounts();
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<OutboxCounts>(OUTBOX_STATUS_EVENT, { detail: counts }),
		);
	}
	return counts;
}

let pendingCountInitialised = false;

/** Bind the header count once and refresh newly rendered header elements. */
export function initialisePendingActionCount(): void {
	if (typeof window === "undefined") return;
	if (!pendingCountInitialised) {
		window.addEventListener(OUTBOX_STATUS_EVENT, (event) => {
			renderPendingActionCountElements(
				(event as CustomEvent<OutboxCounts>).detail,
			);
		});
		pendingCountInitialised = true;
	}
	void publishOutboxStatus().then((counts) =>
		renderPendingActionCountElements(counts),
	);
}

/** Connect shared-engine replay events to library and header presentation. */
export function initialiseLibrarySync(
	engine: Pick<OutboxReplayEngine, "subscribe" | "refreshCounts">,
): () => void {
	const unsubscribe = engine.subscribe(() => void publishOutboxStatus());
	void engine.refreshCounts().then(({ counts }) => {
		if (typeof window !== "undefined") {
			window.dispatchEvent(
				new CustomEvent<OutboxCounts>(OUTBOX_STATUS_EVENT, { detail: counts }),
			);
		}
	});
	return unsubscribe;
}
