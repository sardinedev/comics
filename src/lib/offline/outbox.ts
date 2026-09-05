import { offlineOutbox } from "./database";
import type {
	AddToLibraryOutboxRecord,
	OfflineOutboxRecord,
	ProgressOutboxRecord,
} from "./types";

export type OutboxHandlerResult = {
	status: number;
	statusText?: string;
};

export type OutboxReplayHandlers = {
	/** Sends a progress mutation; thrown errors are treated as retryable failures. */
	progress: (record: ProgressOutboxRecord) => Promise<OutboxHandlerResult>;
	/** Sends a library mutation; thrown errors are treated as retryable failures. */
	"add-to-library": (
		record: AddToLibraryOutboxRecord,
	) => Promise<OutboxHandlerResult>;
};

export type OutboxRepository = {
	/**
	 * Atomically settles a record only if its dedupe key, id, and updatedAt still match.
	 *
	 * @param expected - The version observed before dispatch.
	 * @param replacement - The updated record, or null to delete it.
	 * @returns Whether the expected version was found and settled.
	 */
	updateIfCurrent: (
		expected: OfflineOutboxRecord,
		replacement: OfflineOutboxRecord | null,
	) => Promise<boolean>;
	/** Returns all records, including failed and not-yet-due mutations. */
	getAll: () => Promise<OfflineOutboxRecord[]>;
	/** Returns the current mutation for a dedupe key, or undefined if absent. */
	getByDedupeKey: (
		dedupeKey: string,
	) => Promise<OfflineOutboxRecord | undefined>;
	/** Stores a mutation, replacing any older record with the same dedupe key. */
	put: (record: OfflineOutboxRecord) => Promise<void>;
	/** Deletes a mutation by id; an absent record is a no-op. */
	delete: (id: string) => Promise<void>;
};

export type OutboxCounts = {
	pending: number;
	failed: number;
	total: number;
};

export type OutboxReplayState = {
	isReplaying: boolean;
	counts: OutboxCounts;
};

export type OutboxRecordOutcome =
	| "succeeded"
	| "retry-scheduled"
	| "failed"
	| "superseded";

export type OutboxReplayEvent =
	| {
		type: "state";
		state: OutboxReplayState;
	}
	| {
		type: "record";
		record: OfflineOutboxRecord;
		outcome: OutboxRecordOutcome;
		state: OutboxReplayState;
	}
	| {
		type: "auth-invalid";
		record: OfflineOutboxRecord;
		status: 401 | 403;
		state: OutboxReplayState;
	};

export type OutboxReplaySummary = {
	attempted: number;
	succeeded: number;
	retryScheduled: number;
	failed: number;
	superseded: number;
	skippedNotDue: number;
	authInvalid: boolean;
};

export type OutboxReplayOptions = {
	handlers: OutboxReplayHandlers;
	/**
	 * Handles a 401 or 403 before replay stops, without the engine settling the record.
	 * A rejected callback rejects replay; callers own any session cleanup.
	 */
	onAuthInvalid: (
		record: OfflineOutboxRecord,
		status: 401 | 403,
	) => void | Promise<void>;
	repository?: OutboxRepository;
	/** Supplies the clock for due checks and mutation timestamps; defaults to system time. */
	now?: () => Date;
	/**
	 * Returns a finite backoff in milliseconds for the incremented attempt count.
	 * Negative delays are clamped to zero; the default doubles from one second to five minutes.
	 */
	retryDelayMs?: (attempts: number) => number;
};

const EMPTY_COUNTS: OutboxCounts = { pending: 0, failed: 0, total: 0 };

/**
 * Calculates exponential backoff, starting at one second and capped at five minutes.
 *
 * @param attempts - Failure count after incrementing for the current attempt.
 * @returns The delay in milliseconds.
 */
function defaultRetryDelayMs(attempts: number): number {
	return Math.min(1_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

/** Extracts a nonempty error message, falling back to a generic network failure. */
function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Network request failed";
}

/** Formats the HTTP status and optional status text for persisted failure metadata. */
function describeResponse(response: OutboxHandlerResult): string {
	return response.statusText
		? `HTTP ${response.status}: ${response.statusText}`
		: `HTTP ${response.status}`;
}

/** Returns a sorted copy ordered by creation timestamp, then id for deterministic ties. */
function sortRecords(records: OfflineOutboxRecord[]): OfflineOutboxRecord[] {
	return [...records].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) ||
			left.id.localeCompare(right.id),
	);
}

/**
 * Checks whether a mutation can be attempted at the supplied time.
 * Missing or unparseable retry timestamps are treated as immediately due.
 */
function isDue(record: OfflineOutboxRecord, now: Date): boolean {
	if (!record.nextAttemptAt) return true;
	const nextAttempt = Date.parse(record.nextAttemptAt);
	return Number.isNaN(nextAttempt) || nextAttempt <= now.getTime();
}

/**
 * Counts pending and permanently failed mutations with one full repository read.
 *
 * @param repository - Storage to inspect; defaults to the browser's offline outbox.
 * @returns Counts including pending mutations whose retry time has not arrived.
 * @throws Propagates repository read failures.
 */
export async function getOutboxCounts(
	repository: Pick<OutboxRepository, "getAll"> = offlineOutbox,
): Promise<OutboxCounts> {
	const records = await repository.getAll();
	const pending = records.filter(({ status }) => status === "pending").length;
	const failed = records.filter(({ status }) => status === "failed").length;
	return { pending, failed, total: records.length };
}

/**
 * Replays pending mutations serially in creation order.
 *
 * The engine is deliberately transport-agnostic: callers inject one handler
 * for each mutation kind. A single engine instance coalesces concurrent
 * `replay()` calls onto the same promise.
 *
 * @remarks
 * This engine does not schedule timers or coordinate replay across tabs or
 * instances. Callers must trigger subsequent passes and provide idempotent
 * transports where repeated requests could otherwise duplicate effects.
 */
export class OutboxReplayEngine {
	readonly #handlers: OutboxReplayHandlers;
	readonly #onAuthInvalid: OutboxReplayOptions["onAuthInvalid"];
	readonly #repository: OutboxRepository;
	readonly #now: () => Date;
	readonly #retryDelayMs: (attempts: number) => number;
	readonly #listeners = new Set<(event: OutboxReplayEvent) => void>();
	#activeReplay: Promise<OutboxReplaySummary> | undefined;
	#countsRevision = 0;
	#countedStatuses = new Map<string, OfflineOutboxRecord["status"]>();
	#state: OutboxReplayState = {
		isReplaying: false,
		counts: EMPTY_COUNTS,
	};

	/**
	 * Creates an idle engine without accessing storage or starting replay.
	 *
	 * @param options - Transports, auth handling, and optional storage, clock, and backoff overrides.
	 */
	constructor(options: OutboxReplayOptions) {
		this.#handlers = options.handlers;
		this.#onAuthInvalid = options.onAuthInvalid;
		this.#repository = options.repository ?? offlineOutbox;
		this.#now = options.now ?? (() => new Date());
		this.#retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
	}

	/**
	 * Returns a defensive copy of the latest replay state and counts.
	 * Counts start at zero and are reconciled by replay or an explicit refresh.
	 */
	get state(): OutboxReplayState {
		return {
			isReplaying: this.#state.isReplaying,
			counts: { ...this.#state.counts },
		};
	}

	/**
	 * Registers a synchronous observer for future events, without an initial emission.
	 *
	 * @param listener - Observer whose synchronous exceptions are isolated from replay.
	 * @returns A function that removes the observer; repeated removal is harmless.
	 */
	subscribe(listener: (event: OutboxReplayEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Reconciles queue counts from storage and emits a state event without changing replay activity.
	 *
	 * @returns The latest state, which may include a newer update than this read.
	 * @remarks
	 * Reads superseded by a newer count operation do not overwrite cached counts.
	 * @throws Propagates repository read failures.
	 */
	async refreshCounts(): Promise<OutboxReplayState> {
		await this.#readCounts();
		this.#emit({ type: "state", state: this.state });
		return this.state;
	}

	/**
	 * Runs one pass over a snapshot of pending mutations, rechecking each before dispatch.
	 *
	 * @returns The active pass's promise, shared by concurrent calls on this instance.
	 * @remarks
	 * Successful 2xx responses remove current records. Network errors, 408, 429,
	 * and other non-4xx failures persist retry metadata; other non-auth 4xx responses
	 * mark records failed. A 401 or 403 invokes auth handling and stops the pass.
	 * Not-yet-due and superseded records are skipped. New mutations and scheduled
	 * retries require a later call; there is no automatic drain or retry timer.
	 * @throws Rejects on repository or auth-callback failures, rather than transport failures.
	 */
	replay(): Promise<OutboxReplaySummary> {
		if (this.#activeReplay) return this.#activeReplay;

		const replay = this.#run().finally(() => {
			this.#activeReplay = undefined;
		});
		this.#activeReplay = replay;
		return replay;
	}

	/**
	 * Executes the ordered pass, classifies outcomes, and publishes lifecycle events.
	 * Always clears replay activity and attempts a final count refresh, including on failure.
	 */
	async #run(): Promise<OutboxReplaySummary> {
		const summary: OutboxReplaySummary = {
			attempted: 0,
			succeeded: 0,
			retryScheduled: 0,
			failed: 0,
			superseded: 0,
			skippedNotDue: 0,
			authInvalid: false,
		};

		this.#state.isReplaying = true;
		try {
			const records = sortRecords(await this.#readCounts()).filter(
				({ status }) => status === "pending",
			);
			this.#emit({ type: "state", state: this.state });

			for (const record of records) {
				const current = await this.#repository.getByDedupeKey(record.dedupeKey);
				if (
					current?.id !== record.id ||
					current.updatedAt !== record.updatedAt ||
					current.status !== "pending"
				) {
					summary.superseded += 1;
					await this.#emitRecord(record, "superseded");
					continue;
				}

				if (!isDue(current, this.#now())) {
					summary.skippedNotDue += 1;
					continue;
				}

				summary.attempted += 1;
				let response: OutboxHandlerResult;
				try {
					response = await this.#handle(record);
				} catch (error) {
					const outcome = await this.#scheduleRetry(
						record,
						describeError(error),
					);
					summary[outcome === "superseded" ? "superseded" : "retryScheduled"] +=
						1;
					await this.#emitRecord(record, outcome);
					continue;
				}

				if (response.status >= 200 && response.status < 300) {
					const outcome = await this.#deleteIfCurrent(record);
					summary[outcome === "superseded" ? "superseded" : "succeeded"] += 1;
					await this.#emitRecord(record, outcome);
					continue;
				}

				if (response.status === 401 || response.status === 403) {
					summary.authInvalid = true;
					await this.#onAuthInvalid(record, response.status);
					await this.refreshCounts();
					this.#emit({
						type: "auth-invalid",
						record,
						status: response.status,
						state: this.state,
					});
					break;
				}

				if (
					response.status >= 400 &&
					response.status < 500 &&
					response.status !== 408 &&
					response.status !== 429
				) {
					const outcome = await this.#markFailed(
						record,
						describeResponse(response),
					);
					summary[outcome === "superseded" ? "superseded" : "failed"] += 1;
					await this.#emitRecord(record, outcome);
					continue;
				}

				const outcome = await this.#scheduleRetry(
					record,
					describeResponse(response),
				);
				summary[outcome === "superseded" ? "superseded" : "retryScheduled"] +=
					1;
				await this.#emitRecord(record, outcome);
			}

			return summary;
		} finally {
			this.#state.isReplaying = false;
			await this.refreshCounts();
		}
	}

	/** Dispatches to the mutation-specific transport without catching its errors. */
	#handle(record: OfflineOutboxRecord): Promise<OutboxHandlerResult> {
		if (record.kind === "progress") return this.#handlers.progress(record);
		return this.#handlers["add-to-library"](record);
	}

	/**
	 * Removes a successfully sent mutation only if its stored version still matches.
	 *
	 * @returns Succeeded when removed, or superseded when storage no longer matches.
	 */
	async #deleteIfCurrent(
		record: OfflineOutboxRecord,
	): Promise<"succeeded" | "superseded"> {
		return (await this.#repository.updateIfCurrent(record, null))
			? "succeeded"
			: "superseded";
	}

	/**
	 * Persists an incremented attempt count, error, and backoff deadline for the current version.
	 *
	 * @param record - The attempted mutation, before its failure metadata is updated.
	 * @param lastError - The message to persist for subsequent inspection.
	 * @returns Retry-scheduled when updated, or superseded when storage no longer matches.
	 * @remarks Persists a deadline only; it does not start a timer or another replay pass.
	 */
	async #scheduleRetry(
		record: OfflineOutboxRecord,
		lastError: string,
	): Promise<"retry-scheduled" | "superseded"> {
		const attempts = record.attempts + 1;
		const now = this.#now();
		const updated = await this.#repository.updateIfCurrent(record, {
			...record,
			attempts,
			status: "pending",
			updatedAt: now.toISOString(),
			nextAttemptAt: new Date(
				now.getTime() + Math.max(0, this.#retryDelayMs(attempts)),
			).toISOString(),
			lastError,
		});
		return updated ? "retry-scheduled" : "superseded";
	}

	/**
	 * Marks the current mutation permanently failed, increments attempts, and clears its retry deadline.
	 *
	 * @param record - The attempted mutation whose version must still match storage.
	 * @param lastError - The permanent failure message to persist.
	 * @returns Failed when updated, or superseded when storage no longer matches.
	 */
	async #markFailed(
		record: OfflineOutboxRecord,
		lastError: string,
	): Promise<"failed" | "superseded"> {
		const updated = await this.#repository.updateIfCurrent(record, {
			...record,
			attempts: record.attempts + 1,
			status: "failed",
			updatedAt: this.#now().toISOString(),
			nextAttemptAt: undefined,
			lastError,
		});
		return updated ? "failed" : "superseded";
	}

	/**
	 * Reconciles counts for one dedupe key and emits a record event without a full queue scan.
	 *
	 * @param record - The original replay snapshot, not the updated or replacement mutation.
	 * @param outcome - The result of dispatch or the pre-dispatch version check.
	 * @remarks
	 * Invalidates overlapping full reads. Changes to unrelated keys become visible
	 * during their own reconciliation or the next full count refresh.
	 */
	async #emitRecord(
		record: OfflineOutboxRecord,
		outcome: OutboxRecordOutcome,
	): Promise<void> {
		const current = await this.#repository.getByDedupeKey(record.dedupeKey);
		this.#countsRevision += 1;
		const previousStatus = this.#countedStatuses.get(record.dedupeKey);
		if (previousStatus) {
			this.#state.counts[previousStatus] -= 1;
			this.#state.counts.total -= 1;
			this.#countedStatuses.delete(record.dedupeKey);
		}
		if (current) {
			this.#state.counts[current.status] += 1;
			this.#state.counts.total += 1;
			this.#countedStatuses.set(record.dedupeKey, current.status);
		}
		this.#emit({ type: "record", record, outcome, state: this.state });
	}

	/**
	 * Reads the queue and updates cached counts only if no newer count operation has intervened.
	 *
	 * @returns The fetched snapshot even when its count update was superseded.
	 * @remarks Does not change replay activity or emit an event.
	 */
	async #readCounts(): Promise<OfflineOutboxRecord[]> {
		const revision = ++this.#countsRevision;
		const records = await this.#repository.getAll();
		if (revision === this.#countsRevision) {
			this.#countedStatuses = new Map(
				records.map((record) => [record.dedupeKey, record.status]),
			);
			this.#state.counts = {
				pending: records.filter(({ status }) => status === "pending").length,
				failed: records.filter(({ status }) => status === "failed").length,
				total: records.length,
			};
		}
		return records;
	}

	/** Delivers an event synchronously, isolating thrown observer errors from synchronization. */
	#emit(event: OutboxReplayEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch {
				// A presentation listener must never interrupt synchronization.
			}
		}
	}
}

/**
 * Creates an idle, independently coordinated replay engine.
 *
 * @param options - Mutation handlers, auth handling, and optional runtime overrides.
 * @returns An engine ready for explicit count refreshes, subscriptions, and replay calls.
 */
export function createOutboxReplayEngine(
	options: OutboxReplayOptions,
): OutboxReplayEngine {
	return new OutboxReplayEngine(options);
}
