import { describe, expect, test, vi } from "vitest";
import {
	createOutboxReplayEngine,
	getOutboxCounts,
	type OutboxReplayEvent,
	type OutboxRepository,
} from "./outbox";
import type {
	AddToLibraryOutboxRecord,
	OfflineOutboxRecord,
	ProgressOutboxRecord,
} from "./types";

const progressRecord: ProgressOutboxRecord = {
	id: "progress-1",
	dedupeKey: "progress:issue-1",
	kind: "progress",
	payload: {
		issueId: "issue-1",
		currentPage: 10,
		totalPages: 24,
		updatedAt: "2026-08-16T10:01:00.000Z",
		mutationId: "progress-1",
	},
	createdAt: "2026-08-16T10:01:00.000Z",
	updatedAt: "2026-08-16T10:01:00.000Z",
	attempts: 0,
	status: "pending",
};

const libraryRecord: AddToLibraryOutboxRecord = {
	id: "library-1",
	dedupeKey: "library:series-1",
	kind: "add-to-library",
	payload: { seriesId: "series-1" },
	createdAt: "2026-08-16T10:00:00.000Z",
	updatedAt: "2026-08-16T10:00:00.000Z",
	attempts: 0,
	status: "pending",
};

class MemoryOutboxRepository implements OutboxRepository {
	readonly records = new Map<string, OfflineOutboxRecord>();

	/** Seeds the test repository with records indexed by mutation id. */
	constructor(records: OfflineOutboxRecord[] = []) {
		for (const record of records) this.records.set(record.id, record);
	}

	/** Settles by dedupe key only when id and timestamp match, without yielding between lookup and write. */
	async updateIfCurrent(
		expected: OfflineOutboxRecord,
		replacement: OfflineOutboxRecord | null,
	): Promise<boolean> {
		const current = [...this.records.values()].find(
			(record) => record.dedupeKey === expected.dedupeKey,
		);
		if (
			current?.id !== expected.id ||
			current.updatedAt !== expected.updatedAt
		) {
			return false;
		}
		if (replacement) this.records.set(replacement.id, replacement);
		else this.records.delete(expected.id);
		return true;
	}

	/** Returns a new array of stored record references without imposing replay order. */
	async getAll(): Promise<OfflineOutboxRecord[]> {
		return [...this.records.values()];
	}

	/** Finds the current record for a dedupe key, or undefined when no match exists. */
	async getByDedupeKey(
		dedupeKey: string,
	): Promise<OfflineOutboxRecord | undefined> {
		return [...this.records.values()].find(
			(record) => record.dedupeKey === dedupeKey,
		);
	}

	/** Stores a record while removing any different id with the same dedupe key. */
	async put(record: OfflineOutboxRecord): Promise<void> {
		const existing = await this.getByDedupeKey(record.dedupeKey);
		if (existing && existing.id !== record.id) this.records.delete(existing.id);
		this.records.set(record.id, record);
	}

	/** Removes a stored mutation by id; missing ids are harmless. */
	async delete(id: string): Promise<void> {
		this.records.delete(id);
	}
}

/**
 * Creates a manually resolved promise for deterministic replay-race tests.
 *
 * @typeParam T - The value supplied when the test releases the promise.
 * @returns The pending promise and its externally callable resolver.
 */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

/** Creates configurable transport spies that succeed by default for both mutation kinds. */
function createHandlers() {
	return {
		progress: vi.fn(
			async (): Promise<{ status: number; statusText?: string }> => ({
				status: 204,
			}),
		),
		"add-to-library": vi.fn(
			async (): Promise<{ status: number; statusText?: string }> => ({
				status: 200,
			}),
		),
	};
}

describe("MemoryOutboxRepository", () => {
	test.each([
		{ dedupeKey: "progress:other-issue" },
		{ id: "replacement-id" },
		{ updatedAt: "2026-08-16T12:00:00.000Z" },
	])("rejects settlement when the stored version differs by %j", async (change) => {
		const stored = { ...progressRecord, ...change };
		const repository = new MemoryOutboxRepository([stored]);

		await expect(
			repository.updateIfCurrent(progressRecord, null),
		).resolves.toBe(false);
		await expect(
			repository.updateIfCurrent(progressRecord, {
				...progressRecord,
				status: "failed",
			}),
		).resolves.toBe(false);
		expect(await repository.getAll()).toEqual([stored]);
	});
});

describe("OutboxReplayEngine", () => {
	test("replays pending records in creation order and deletes 2xx successes", async () => {
		const repository = new MemoryOutboxRepository([
			progressRecord,
			libraryRecord,
			{
				...progressRecord,
				id: "failed",
				dedupeKey: "progress:failed",
				status: "failed",
			},
		]);
		const order: string[] = [];
		const events: OutboxReplayEvent[] = [];
		const engine = createOutboxReplayEngine({
			repository,
			handlers: {
				progress: async (record) => {
					order.push(record.id);
					return { status: 204 };
				},
				"add-to-library": async (record) => {
					order.push(record.id);
					return { status: 201 };
				},
			},
			onAuthInvalid: vi.fn(),
		});
		engine.subscribe((event) => events.push(event));

		await expect(engine.replay()).resolves.toEqual({
			attempted: 2,
			succeeded: 2,
			retryScheduled: 0,
			failed: 0,
			superseded: 0,
			skippedNotDue: 0,
			authInvalid: false,
		});

		expect(order).toEqual(["library-1", "progress-1"]);
		expect([...repository.records.keys()]).toEqual(["failed"]);
		expect(engine.state).toEqual({
			isReplaying: false,
			counts: { pending: 0, failed: 1, total: 1 },
		});
		expect(
			events
				.filter((event) => event.type === "record")
				.map((event) => [event.record.id, event.outcome]),
		).toEqual([
			["library-1", "succeeded"],
			["progress-1", "succeeded"],
		]);
		expect(events.at(-1)).toMatchObject({
			type: "state",
			state: { isReplaying: false },
		});
	});

	test("retains network and 5xx failures with retry metadata", async () => {
		const repository = new MemoryOutboxRepository([
			libraryRecord,
			progressRecord,
		]);
		const engine = createOutboxReplayEngine({
			repository,
			handlers: {
				progress: async () => ({ status: 503, statusText: "Unavailable" }),
				"add-to-library": async () => {
					throw new TypeError("Failed to fetch");
				},
			},
			onAuthInvalid: vi.fn(),
			now: () => new Date("2026-08-16T12:00:00.000Z"),
			retryDelayMs: (attempts) => attempts * 5_000,
		});

		const summary = await engine.replay();

		expect(summary.retryScheduled).toBe(2);
		expect(repository.records.get(libraryRecord.id)).toMatchObject({
			attempts: 1,
			status: "pending",
			lastError: "Failed to fetch",
			nextAttemptAt: "2026-08-16T12:00:05.000Z",
		});
		expect(repository.records.get(progressRecord.id)).toMatchObject({
			attempts: 1,
			status: "pending",
			lastError: "HTTP 503: Unavailable",
			nextAttemptAt: "2026-08-16T12:00:05.000Z",
		});

		const second = await engine.replay();
		expect(second).toMatchObject({ attempted: 0, skippedNotDue: 2 });
	});

	test.each([
		408, 429,
	])("retries transient HTTP %s responses", async (status) => {
		const repository = new MemoryOutboxRepository([progressRecord]);
		const handlers = createHandlers();
		handlers.progress.mockResolvedValueOnce({ status });
		let now = new Date("2026-08-16T12:00:00.000Z");
		const engine = createOutboxReplayEngine({
			repository,
			handlers,
			onAuthInvalid: vi.fn(),
			now: () => now,
		});

		await expect(engine.replay()).resolves.toMatchObject({
			retryScheduled: 1,
			failed: 0,
		});
		expect(repository.records.get(progressRecord.id)).toMatchObject({
			status: "pending",
			attempts: 1,
			nextAttemptAt: "2026-08-16T12:00:01.000Z",
		});
		now = new Date("2026-08-16T12:00:01.000Z");
		await expect(engine.replay()).resolves.toMatchObject({ succeeded: 1 });
	});

	test.each([
		"deleted",
		"replaced",
		"updated",
	] as const)("does not dispatch a waiting record that was %s", async (change) => {
		const repository = new MemoryOutboxRepository([
			libraryRecord,
			progressRecord,
		]);
		const handlers = createHandlers();
		handlers["add-to-library"].mockImplementation(async () => {
			if (change === "deleted") {
				await repository.delete(progressRecord.id);
			} else {
				await repository.put({
					...progressRecord,
					id: change === "replaced" ? "progress-2" : progressRecord.id,
					updatedAt: "2026-08-16T12:00:00.000Z",
				});
			}
			return { status: 204 };
		});
		const engine = createOutboxReplayEngine({
			repository,
			handlers,
			onAuthInvalid: vi.fn(),
		});

		await expect(engine.replay()).resolves.toMatchObject({
			attempted: 1,
			succeeded: 1,
			superseded: 1,
		});
		expect(handlers.progress).not.toHaveBeenCalled();
		expect(engine.state.counts.total).toBe(change === "deleted" ? 0 : 1);
	});

	test("does not restore stale state or counts from an overlapping refresh", async () => {
		const repository = new MemoryOutboxRepository([progressRecord]);
		const handlers = createHandlers();
		const started = deferred<void>();
		const response = deferred<{ status: number }>();
		const counts = deferred<OfflineOutboxRecord[]>();
		handlers.progress.mockImplementation(() => {
			started.resolve();
			return response.promise;
		});
		const engine = createOutboxReplayEngine({
			repository,
			handlers,
			onAuthInvalid: vi.fn(),
		});
		const replay = engine.replay();
		await started.promise;
		vi.spyOn(repository, "getAll").mockImplementationOnce(() => counts.promise);
		const refresh = engine.refreshCounts();
		response.resolve({ status: 204 });
		await replay;
		counts.resolve([progressRecord]);
		await refresh;

		expect(engine.state).toEqual({
			isReplaying: false,
			counts: { pending: 0, failed: 0, total: 0 },
		});
	});

	test("keeps full queue reads bounded and emits current counts per record", async () => {
		const records = Array.from({ length: 20 }, (_, index) => ({
			...progressRecord,
			id: `progress-${index}`,
			dedupeKey: `progress:issue-${index}`,
		}));
		const repository = new MemoryOutboxRepository(records);
		const getAll = vi.spyOn(repository, "getAll");
		const events: OutboxReplayEvent[] = [];
		const engine = createOutboxReplayEngine({
			repository,
			handlers: createHandlers(),
			onAuthInvalid: vi.fn(),
		});
		engine.subscribe((event) => events.push(event));

		await engine.replay();

		expect(getAll.mock.calls.length).toBeLessThanOrEqual(3);
		expect(events.filter((event) => event.type === "state")).toHaveLength(2);
		expect(
			events
				.filter((event) => event.type === "record")
				.map((event) => event.state.counts),
		).toEqual(
			records.map((_, index) => ({
				pending: records.length - index - 1,
				failed: 0,
				total: records.length - index - 1,
			})),
		);
	});

	test("marks a permanent non-auth 4xx response as failed", async () => {
		const repository = new MemoryOutboxRepository([progressRecord]);
		const handlers = createHandlers();
		handlers.progress.mockResolvedValue({
			status: 422,
			statusText: "Invalid page",
		});
		const engine = createOutboxReplayEngine({
			repository,
			handlers,
			onAuthInvalid: vi.fn(),
			now: () => new Date("2026-08-16T12:00:00.000Z"),
		});

		const summary = await engine.replay();

		expect(summary.failed).toBe(1);
		expect(repository.records.get(progressRecord.id)).toMatchObject({
			attempts: 1,
			status: "failed",
			lastError: "HTTP 422: Invalid page",
			nextAttemptAt: undefined,
		});
		expect(await getOutboxCounts(repository)).toEqual({
			pending: 0,
			failed: 1,
			total: 1,
		});
	});

	test.each([
		401, 403,
	] as const)("invokes auth invalidation and stops replay on %s", async (status) => {
		const repository = new MemoryOutboxRepository([
			libraryRecord,
			progressRecord,
		]);
		const onAuthInvalid = vi.fn();
		const progressHandler = vi.fn(async () => ({ status: 204 }));
		const engine = createOutboxReplayEngine({
			repository,
			handlers: {
				progress: progressHandler,
				"add-to-library": async () => ({ status }),
			},
			onAuthInvalid,
		});

		const summary = await engine.replay();

		expect(summary).toMatchObject({ attempted: 1, authInvalid: true });
		expect(onAuthInvalid).toHaveBeenCalledWith(libraryRecord, status);
		expect(progressHandler).not.toHaveBeenCalled();
		expect(repository.records.size).toBe(2);
	});

	test("does not overwrite a newer deduplicated mutation during replay", async () => {
		const repository = new MemoryOutboxRepository([progressRecord]);
		const started = deferred<void>();
		const response = deferred<{ status: number }>();
		const engine = createOutboxReplayEngine({
			repository,
			handlers: {
				progress: () => {
					started.resolve();
					return response.promise;
				},
				"add-to-library": async () => ({ status: 204 }),
			},
			onAuthInvalid: vi.fn(),
		});

		const replay = engine.replay();
		await started.promise;
		const newerRecord: ProgressOutboxRecord = {
			...progressRecord,
			id: "progress-2",
			updatedAt: "2026-08-16T11:00:00.000Z",
			payload: {
				...progressRecord.payload,
				currentPage: 20,
				updatedAt: "2026-08-16T11:00:00.000Z",
			},
		};
		await repository.put(newerRecord);
		response.resolve({ status: 503 });

		const summary = await replay;

		expect(summary).toMatchObject({ superseded: 1, retryScheduled: 0 });
		expect([...repository.records.values()]).toEqual([newerRecord]);
	});

	test("coalesces concurrent replay calls", async () => {
		const repository = new MemoryOutboxRepository([progressRecord]);
		const response = deferred<{ status: number }>();
		const handler = vi.fn(() => response.promise);
		const engine = createOutboxReplayEngine({
			repository,
			handlers: {
				progress: handler,
				"add-to-library": async () => ({ status: 204 }),
			},
			onAuthInvalid: vi.fn(),
		});

		const firstReplay = engine.replay();
		const secondReplay = engine.replay();
		expect(secondReplay).toBe(firstReplay);
		response.resolve({ status: 204 });

		await expect(firstReplay).resolves.toMatchObject({ succeeded: 1 });
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
