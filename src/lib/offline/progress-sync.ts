import { clearOfflineData } from "./clear";
import {
	offlineOutbox,
	offlineProgress,
	queueProgressUpdate,
} from "./database";
import {
	createOutboxReplayEngine,
	type OutboxReplayEngine,
	type OutboxRepository,
} from "./outbox";
import type {
	OfflineOutboxRecord,
	OfflineProgressRecord,
	ProgressOutboxRecord,
} from "./types";

export type SaveReadingProgressInput = {
	issueId: string;
	currentPage: number;
	totalPages: number;
	updatedAt?: string;
	mutationId?: string;
};

export type SaveReadingProgressResult = {
	queued: boolean;
	progress: OfflineProgressRecord;
	mutation?: ProgressOutboxRecord;
};

type ProgressRepository = {
	get: (issueId: string) => Promise<OfflineProgressRecord | undefined>;
	put: (record: OfflineProgressRecord) => Promise<void>;
};

export type SaveReadingProgressDependencies = {
	getProgress?: ProgressRepository["get"];
	queueUpdate?: typeof queueProgressUpdate;
	now?: () => Date;
	createMutationId?: () => string;
};

export type ProgressReplayHandlerOptions = {
	fetcher?: typeof fetch;
	progressRepository?: ProgressRepository;
};

export type ProgressReplayEngineOptions = ProgressReplayHandlerOptions & {
	outboxRepository?: OutboxRepository;
	onAuthInvalid?: () => void | Promise<void>;
	now?: () => Date;
	retryDelayMs?: (attempts: number) => number;
};

function normalizedTimestamp(
	value: string | undefined,
	now: () => Date,
): string {
	const date = value === undefined ? now() : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error("updatedAt must be a valid ISO timestamp");
	}
	return date.toISOString();
}

function defaultMutationId(): string {
	return crypto.randomUUID();
}

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

/** Atomically saves local reading progress and its deduplicated outbox write. */
export async function saveReadingProgress(
	input: SaveReadingProgressInput,
	dependencies: SaveReadingProgressDependencies = {},
): Promise<SaveReadingProgressResult> {
	validateProgress(input);
	const now = dependencies.now ?? (() => new Date());
	const updatedAt = normalizedTimestamp(input.updatedAt, now);
	const getProgress = dependencies.getProgress ?? offlineProgress.get;
	const existing = await getProgress(input.issueId);
	if (existing && existing.updatedAt.localeCompare(updatedAt) >= 0) {
		return { queued: false, progress: existing };
	}

	const mutationId =
		input.mutationId ?? (dependencies.createMutationId ?? defaultMutationId)();
	if (!mutationId.trim()) throw new Error("mutationId is required");

	const progress: OfflineProgressRecord = {
		issueId: input.issueId,
		currentPage: input.currentPage,
		totalPages: input.totalPages,
		updatedAt,
		syncStatus: "pending",
	};
	const mutation: ProgressOutboxRecord = {
		id: mutationId,
		dedupeKey: `progress:${input.issueId}`,
		kind: "progress",
		payload: {
			issueId: input.issueId,
			currentPage: input.currentPage,
			totalPages: input.totalPages,
			updatedAt,
			mutationId,
		},
		createdAt: updatedAt,
		updatedAt,
		attempts: 0,
		status: "pending",
	};

	await (dependencies.queueUpdate ?? queueProgressUpdate)(progress, mutation);
	return { queued: true, progress, mutation };
}

async function updateProgressStatus(
	record: ProgressOutboxRecord,
	repository: ProgressRepository,
	syncStatus: OfflineProgressRecord["syncStatus"],
	lastError?: string,
): Promise<void> {
	const current = await repository.get(record.payload.issueId);
	if (!current || current.updatedAt !== record.payload.updatedAt) return;
	await repository.put({ ...current, syncStatus, lastError });
}

type ProgressSyncResponse = {
	stale?: unknown;
	current_page?: unknown;
	updated_at?: unknown;
};

function isAuthoritativeProgress(
	body: ProgressSyncResponse,
): body is { stale: true; current_page: number; updated_at: string } {
	return (
		body.stale === true &&
		typeof body.current_page === "number" &&
		Number.isInteger(body.current_page) &&
		body.current_page > 0 &&
		typeof body.updated_at === "string" &&
		!Number.isNaN(Date.parse(body.updated_at))
	);
}

/** Creates the transport handler consumed by the generic outbox engine. */
export function createProgressReplayHandler(
	options: ProgressReplayHandlerOptions = {},
): (record: ProgressOutboxRecord) => Promise<Response> {
	const fetcher = options.fetcher ?? fetch;
	const progressRepository = options.progressRepository ?? offlineProgress;

	return async (record) => {
		const response = await fetcher(
			`/api/comic/${encodeURIComponent(record.payload.issueId)}/progress`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					current_page: record.payload.currentPage,
					total_pages: record.payload.totalPages,
					updated_at: record.payload.updatedAt,
					mutation_id: record.payload.mutationId,
				}),
			},
		);

		if (response.ok) {
			const body = (await response
				.clone()
				.json()
				.catch(() => ({}))) as ProgressSyncResponse;
			if (body.stale === true) {
				if (!isAuthoritativeProgress(body)) {
					return new Response(null, {
						status: 502,
						statusText: "Invalid stale progress response",
					});
				}
				const current = await progressRepository.get(record.payload.issueId);
				if (current?.updatedAt === record.payload.updatedAt) {
					await progressRepository.put({
						issueId: record.payload.issueId,
						currentPage: body.current_page,
						totalPages: record.payload.totalPages,
						updatedAt: new Date(body.updated_at).toISOString(),
						syncStatus: "synced",
					});
				}
			} else {
				await updateProgressStatus(record, progressRepository, "synced");
			}
		} else if (
			response.status >= 400 &&
			response.status < 500 &&
			response.status !== 401 &&
			response.status !== 403
		) {
			await updateProgressStatus(
				record,
				progressRepository,
				"failed",
				`HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`,
			);
		}

		return response;
	};
}

function progressOnlyRepository(
	repository: OutboxRepository,
): OutboxRepository {
	return {
		getAll: async () =>
			(await repository.getAll()).filter(
				(record): record is ProgressOutboxRecord => record.kind === "progress",
			),
		getByDedupeKey: (dedupeKey) => repository.getByDedupeKey(dedupeKey),
		put: (record) => repository.put(record),
		delete: (id) => repository.delete(id),
	};
}

/** Creates a progress-only replay engine for online launch/foreground events. */
export function createProgressReplayEngine(
	options: ProgressReplayEngineOptions = {},
): OutboxReplayEngine {
	const repository = progressOnlyRepository(
		options.outboxRepository ?? offlineOutbox,
	);
	return createOutboxReplayEngine({
		repository,
		handlers: {
			progress: createProgressReplayHandler(options),
			"add-to-library": async () => ({ status: 500 }),
		},
		onAuthInvalid: async () => {
			if (options.onAuthInvalid) await options.onAuthInvalid();
			else await clearOfflineData();
		},
		now: options.now,
		retryDelayMs: options.retryDelayMs,
	});
}

/** Type guard for consumers observing generic outbox events. */
export function isProgressMutation(
	record: OfflineOutboxRecord,
): record is ProgressOutboxRecord {
	return record.kind === "progress";
}
