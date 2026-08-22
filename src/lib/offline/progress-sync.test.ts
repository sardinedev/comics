import { describe, expect, test, vi } from "vitest";
import type { OutboxRepository } from "./outbox";
import {
	createProgressReplayEngine,
	createProgressReplayHandler,
	saveReadingProgress,
} from "./progress-sync";
import type {
	OfflineOutboxRecord,
	OfflineProgressRecord,
	ProgressOutboxRecord,
} from "./types";

const progress: OfflineProgressRecord = {
	issueId: "issue/1",
	currentPage: 12,
	totalPages: 24,
	updatedAt: "2026-08-16T12:34:56.000Z",
	syncStatus: "pending",
};

const mutation: ProgressOutboxRecord = {
	id: "mutation-1",
	dedupeKey: "progress:issue/1",
	kind: "progress",
	payload: {
		issueId: "issue/1",
		currentPage: 12,
		totalPages: 24,
		updatedAt: "2026-08-16T12:34:56.000Z",
		mutationId: "mutation-1",
	},
	createdAt: "2026-08-16T12:34:56.000Z",
	updatedAt: "2026-08-16T12:34:56.000Z",
	attempts: 0,
	status: "pending",
};

class MemoryProgressRepository {
	readonly records = new Map<string, OfflineProgressRecord>();

	constructor(records: OfflineProgressRecord[] = []) {
		for (const record of records) this.records.set(record.issueId, record);
	}

	async get(issueId: string): Promise<OfflineProgressRecord | undefined> {
		return this.records.get(issueId);
	}

	async put(record: OfflineProgressRecord): Promise<void> {
		this.records.set(record.issueId, record);
	}
}

class MemoryOutboxRepository implements OutboxRepository {
	readonly records = new Map<string, OfflineOutboxRecord>();

	constructor(records: OfflineOutboxRecord[] = []) {
		for (const record of records) this.records.set(record.id, record);
	}

	async getAll(): Promise<OfflineOutboxRecord[]> {
		return [...this.records.values()];
	}

	async getByDedupeKey(
		dedupeKey: string,
	): Promise<OfflineOutboxRecord | undefined> {
		return [...this.records.values()].find(
			(record) => record.dedupeKey === dedupeKey,
		);
	}

	async put(record: OfflineOutboxRecord): Promise<void> {
		this.records.set(record.id, record);
	}

	async delete(id: string): Promise<void> {
		this.records.delete(id);
	}
}

describe("saveReadingProgress", () => {
	test("atomically queues normalized local progress and its mutation", async () => {
		const queueUpdate = vi.fn();

		const result = await saveReadingProgress(
			{
				issueId: "issue-1",
				currentPage: 8,
				totalPages: 20,
				updatedAt: "2026-08-16T13:34:56+01:00",
				mutationId: "mutation-fixed",
			},
			{
				getProgress: async () => undefined,
				queueUpdate,
			},
		);

		expect(result).toMatchObject({
			queued: true,
			progress: {
				issueId: "issue-1",
				currentPage: 8,
				totalPages: 20,
				updatedAt: "2026-08-16T12:34:56.000Z",
				syncStatus: "pending",
			},
			mutation: {
				id: "mutation-fixed",
				dedupeKey: "progress:issue-1",
				payload: {
					totalPages: 20,
					mutationId: "mutation-fixed",
				},
			},
		});
		expect(queueUpdate).toHaveBeenCalledWith(result.progress, result.mutation);
	});

	test("does not replace equal or newer local progress", async () => {
		const queueUpdate = vi.fn();
		const existing = { ...progress, updatedAt: "2026-08-16T13:00:00.000Z" };

		await expect(
			saveReadingProgress(
				{
					issueId: progress.issueId,
					currentPage: 10,
					totalPages: 24,
					updatedAt: "2026-08-16T12:00:00.000Z",
				},
				{ getProgress: async () => existing, queueUpdate },
			),
		).resolves.toEqual({ queued: false, progress: existing });
		expect(queueUpdate).not.toHaveBeenCalled();
	});

	test.each([
		[{ issueId: "", currentPage: 1, totalPages: 1 }, "issueId"],
		[{ issueId: "i", currentPage: 0, totalPages: 1 }, "currentPage"],
		[{ issueId: "i", currentPage: 1, totalPages: 0 }, "totalPages"],
		[{ issueId: "i", currentPage: 2, totalPages: 1 }, "cannot exceed"],
	] as const)("rejects invalid local progress", async (input, message) => {
		await expect(saveReadingProgress(input)).rejects.toThrow(message);
	});
});

describe("createProgressReplayHandler", () => {
	test("sends the timestamped API payload and marks matching progress synced", async () => {
		const repository = new MemoryProgressRepository([progress]);
		const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
		const handler = createProgressReplayHandler({
			fetcher,
			progressRepository: repository,
		});

		await handler(mutation);

		expect(fetcher).toHaveBeenCalledWith(
			"/api/comic/issue%2F1/progress",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({
					current_page: 12,
					total_pages: 24,
					updated_at: progress.updatedAt,
					mutation_id: mutation.id,
				}),
			}),
		);
		expect(repository.records.get(progress.issueId)?.syncStatus).toBe("synced");
	});

	test("marks permanent failures but leaves retryable failures pending", async () => {
		const repository = new MemoryProgressRepository([progress]);
		const permanentHandler = createProgressReplayHandler({
			fetcher: async () =>
				new Response(null, { status: 422, statusText: "Invalid page" }),
			progressRepository: repository,
		});
		await permanentHandler(mutation);
		expect(repository.records.get(progress.issueId)).toMatchObject({
			syncStatus: "failed",
			lastError: "HTTP 422: Invalid page",
		});

		await repository.put(progress);
		const retryHandler = createProgressReplayHandler({
			fetcher: async () => new Response(null, { status: 503 }),
			progressRepository: repository,
		});
		await retryHandler(mutation);
		expect(repository.records.get(progress.issueId)).toEqual(progress);
	});

	test("does not overwrite progress saved while a request was in flight", async () => {
		const repository = new MemoryProgressRepository([
			{ ...progress, updatedAt: "2026-08-16T13:00:00.000Z" },
		]);
		const handler = createProgressReplayHandler({
			fetcher: async () => new Response(null, { status: 200 }),
			progressRepository: repository,
		});

		await handler(mutation);

		expect(repository.records.get(progress.issueId)?.syncStatus).toBe(
			"pending",
		);
	});

	test("replaces stale local progress with the authoritative server value", async () => {
		const repository = new MemoryProgressRepository([progress]);
		const handler = createProgressReplayHandler({
			fetcher: async () =>
				Response.json({
					applied: false,
					stale: true,
					current_page: 19,
					updated_at: "2026-08-16T13:00:00.000Z",
				}),
			progressRepository: repository,
		});

		await expect(handler(mutation)).resolves.toMatchObject({ status: 200 });
		expect(repository.records.get(progress.issueId)).toEqual({
			issueId: progress.issueId,
			currentPage: 19,
			totalPages: progress.totalPages,
			updatedAt: "2026-08-16T13:00:00.000Z",
			syncStatus: "synced",
		});
	});

	test("retries a malformed stale response instead of discarding local progress", async () => {
		const repository = new MemoryProgressRepository([progress]);
		const handler = createProgressReplayHandler({
			fetcher: async () => Response.json({ stale: true }),
			progressRepository: repository,
		});

		await expect(handler(mutation)).resolves.toMatchObject({ status: 502 });
		expect(repository.records.get(progress.issueId)).toEqual(progress);
	});
});

describe("createProgressReplayEngine", () => {
	test("uses generic retry policy for 5xx responses", async () => {
		const outbox = new MemoryOutboxRepository([mutation]);
		const progressRepository = new MemoryProgressRepository([progress]);
		const engine = createProgressReplayEngine({
			outboxRepository: outbox,
			progressRepository,
			fetcher: async () => new Response(null, { status: 503 }),
			now: () => new Date("2026-08-16T14:00:00.000Z"),
			retryDelayMs: () => 5_000,
		});

		await expect(engine.replay()).resolves.toMatchObject({
			retryScheduled: 1,
		});
		expect(outbox.records.get(mutation.id)).toMatchObject({
			attempts: 1,
			nextAttemptAt: "2026-08-16T14:00:05.000Z",
		});
		expect(progressRepository.records.get(progress.issueId)?.syncStatus).toBe(
			"pending",
		);
	});

	test("purges and stops on an auth-invalid response", async () => {
		const laterMutation: ProgressOutboxRecord = {
			...mutation,
			id: "mutation-2",
			dedupeKey: "progress:issue-2",
			payload: { ...mutation.payload, issueId: "issue-2" },
			createdAt: "2026-08-16T13:00:00.000Z",
			updatedAt: "2026-08-16T13:00:00.000Z",
		};
		const outbox = new MemoryOutboxRepository([mutation, laterMutation]);
		const onAuthInvalid = vi.fn();
		const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
		const engine = createProgressReplayEngine({
			outboxRepository: outbox,
			progressRepository: new MemoryProgressRepository([progress]),
			fetcher,
			onAuthInvalid,
		});

		await expect(engine.replay()).resolves.toMatchObject({
			attempted: 1,
			authInvalid: true,
		});
		expect(onAuthInvalid).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledOnce();
	});
});
