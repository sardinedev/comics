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
	progress: (record: ProgressOutboxRecord) => Promise<OutboxHandlerResult>;
	"add-to-library": (
		record: AddToLibraryOutboxRecord,
	) => Promise<OutboxHandlerResult>;
};

export type OutboxRepository = {
	updateIfCurrent: (
		expected: OfflineOutboxRecord,
		replacement: OfflineOutboxRecord | null,
	) => Promise<boolean>;
	getAll: () => Promise<OfflineOutboxRecord[]>;
	getByDedupeKey: (
		dedupeKey: string,
	) => Promise<OfflineOutboxRecord | undefined>;
	put: (record: OfflineOutboxRecord) => Promise<void>;
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
	onAuthInvalid: (
		record: OfflineOutboxRecord,
		status: 401 | 403,
	) => void | Promise<void>;
	repository?: OutboxRepository;
	now?: () => Date;
	retryDelayMs?: (attempts: number) => number;
};

const EMPTY_COUNTS: OutboxCounts = { pending: 0, failed: 0, total: 0 };

/** Spaces out repeated failures while bounding how long recovery is delayed. */
function defaultRetryDelayMs(attempts: number): number {
	return Math.min(1_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

/** Provides an actionable queue error even when the transport throws a non-Error value. */
function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Network request failed";
}

/** Preserves server failure details for pending and failed action displays. */
function describeResponse(response: OutboxHandlerResult): string {
	return response.statusText
		? `HTTP ${response.status}: ${response.statusText}`
		: `HTTP ${response.status}`;
}

/** Makes replay order predictable even when two mutations share a creation timestamp. */
function sortRecords(records: OfflineOutboxRecord[]): OfflineOutboxRecord[] {
	return [...records].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) ||
			left.id.localeCompare(right.id),
	);
}

/** Honors backoff without leaving records stuck on an invalid stored timestamp. */
function isDue(record: OfflineOutboxRecord, now: Date): boolean {
	if (!record.nextAttemptAt) return true;
	const nextAttempt = Date.parse(record.nextAttemptAt);
	return Number.isNaN(nextAttempt) || nextAttempt <= now.getTime();
}

/** Count pending and permanently failed outbox records. */
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
 */
export class OutboxReplayEngine {
	readonly #handlers: OutboxReplayHandlers;
	readonly #onAuthInvalid: OutboxReplayOptions["onAuthInvalid"];
	readonly #repository: OutboxRepository;
	readonly #now: () => Date;
	readonly #retryDelayMs: (attempts: number) => number;
	readonly #listeners = new Set<(event: OutboxReplayEvent) => void>();
	#activeReplay: Promise<OutboxReplaySummary> | undefined;
	#state: OutboxReplayState = {
		isReplaying: false,
		counts: EMPTY_COUNTS,
	};

	constructor(options: OutboxReplayOptions) {
		this.#handlers = options.handlers;
		this.#onAuthInvalid = options.onAuthInvalid;
		this.#repository = options.repository ?? offlineOutbox;
		this.#now = options.now ?? (() => new Date());
		this.#retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
	}

	/** Prevents presentation code from mutating replay state. */
	get state(): OutboxReplayState {
		return {
			isReplaying: this.#state.isReplaying,
			counts: { ...this.#state.counts },
		};
	}

	/** Lets consumers observe replay without coupling the engine to a UI. */
	subscribe(listener: (event: OutboxReplayEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Reconciles status after another consumer changes the durable queue. */
	async refreshCounts(): Promise<OutboxReplayState> {
		await this.#updateState(this.#state.isReplaying);
		return this.state;
	}

	/** Coalesces concurrent triggers so one engine cannot send the same batch twice. */
	replay(): Promise<OutboxReplaySummary> {
		if (this.#activeReplay) return this.#activeReplay;

		const replay = this.#run().finally(() => {
			this.#activeReplay = undefined;
		});
		this.#activeReplay = replay;
		return replay;
	}

	/** Settles queued work in order while preserving retries and authentication boundaries. */
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

		await this.#updateState(true);
		try {
			const records = sortRecords(await this.#repository.getAll()).filter(
				({ status }) => status === "pending",
			);

			for (const record of records) {
				if (!isDue(record, this.#now())) {
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
					await this.#updateState(true);
					this.#emit({
						type: "auth-invalid",
						record,
						status: response.status,
						state: this.state,
					});
					break;
				}

				if (response.status >= 400 && response.status < 500) {
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
			await this.#updateState(false);
		}
	}

	/** Keeps mutation-specific transports separate from shared replay policy. */
	#handle(record: OfflineOutboxRecord): Promise<OutboxHandlerResult> {
		if (record.kind === "progress") return this.#handlers.progress(record);
		return this.#handlers["add-to-library"](record);
	}

	/** Prevents a completed request from removing a newer queued mutation. */
	async #deleteIfCurrent(
		record: OfflineOutboxRecord,
	): Promise<"succeeded" | "superseded"> {
		const deleted = await this.#repository.updateIfCurrent(record, null);
		return deleted ? "succeeded" : "superseded";
	}

	/** Preserves failed work for a later attempt without replacing newer user activity. */
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

	/** Keeps permanent failures visible for user action without overwriting newer work. */
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

	/** Updates counts before consumers react to a completed replay attempt. */
	async #emitRecord(
		record: OfflineOutboxRecord,
		outcome: OutboxRecordOutcome,
	): Promise<void> {
		await this.#updateState(true);
		this.#emit({ type: "record", record, outcome, state: this.state });
	}

	/** Keeps reported queue counts tied to committed repository contents. */
	async #updateState(isReplaying: boolean): Promise<void> {
		this.#state = {
			isReplaying,
			counts: await getOutboxCounts(this.#repository),
		};
		this.#emit({ type: "state", state: this.state });
	}

	/** Isolates listener failures so presentation code cannot interrupt synchronization. */
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

/** Shares replay policy across mutation kinds while allowing their transports to differ. */
export function createOutboxReplayEngine(
	options: OutboxReplayOptions,
): OutboxReplayEngine {
	return new OutboxReplayEngine(options);
}
