import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const records = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./database", () => ({
	offlineOutbox: {
		getAll: vi.fn(async () => [...records.values()]),
		getByDedupeKey: vi.fn(async (dedupeKey: string) =>
			[...records.values()].find(
				(record) => (record as { dedupeKey?: string }).dedupeKey === dedupeKey,
			),
		),
		put: vi.fn(async (record: { id: string; dedupeKey: string }) => {
			for (const [id, existing] of records) {
				if (
					(existing as { dedupeKey?: string }).dedupeKey === record.dedupeKey &&
					id !== record.id
				) {
					records.delete(id);
				}
			}
			records.set(record.id, record);
		}),
		delete: vi.fn(async (id: string) => {
			records.delete(id);
		}),
	},
}));

vi.mock("./clear", () => ({
	clearOfflineData: vi.fn(async () => records.clear()),
}));

import {
	getQueuedAddToLibrary,
	queueAddToLibrary,
	replayAddToLibrary,
	requestAddToLibrary,
} from "./library-sync";
import { createOutboxReplayEngine } from "./outbox";

beforeEach(() => {
	records.clear();
	vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("add-to-library outbox", () => {
	test("deduplicates a series while preserving its stable mutation id", async () => {
		const first = await queueAddToLibrary(
			"series-1",
			new Date("2026-08-16T10:00:00.000Z"),
		);
		const second = await queueAddToLibrary(
			"series-1",
			new Date("2026-08-16T11:00:00.000Z"),
		);

		expect(records.size).toBe(1);
		expect(second.id).toBe(first.id);
		expect(second.dedupeKey).toBe("library:series-1");
		expect(second.createdAt).toBe(first.createdAt);
		expect(second.updatedAt).toBe("2026-08-16T11:00:00.000Z");
	});

	test("queues optimistically without making an offline request", async () => {
		vi.stubGlobal("navigator", { onLine: false });
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(requestAddToLibrary("series-1")).resolves.toEqual({
			status: "pending",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect((await getQueuedAddToLibrary("series-1"))?.status).toBe("pending");
	});

	test("posts JSON online and removes the mutation on success", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		await expect(requestAddToLibrary("series-1")).resolves.toEqual({
			status: "added",
		});
		expect(records.size).toBe(0);
		const init = fetchSpy.mock.calls[0]?.[1];
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toMatchObject({
			seriesId: "series-1",
			mutationId: expect.stringContaining("library:series-1:"),
		});
	});

	test.each([
		[503, "pending"],
		[422, "failed"],
		[401, undefined],
	] as const)("classifies HTTP %s without losing the action", async (status, queuedStatus) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{}", { status, statusText: `Status ${status}` }),
		);

		const result = await requestAddToLibrary("series-1");
		expect(result.status).toBe(
			status === 422 || status === 401 ? "failed" : "pending",
		);
		expect((await getQueuedAddToLibrary("series-1"))?.status).toBe(
			queuedStatus,
		);
	});

	test("retains an ambiguous network failure for replay", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

		await expect(requestAddToLibrary("series-1")).resolves.toEqual({
			status: "pending",
		});
		expect(await getQueuedAddToLibrary("series-1")).toMatchObject({
			status: "pending",
			lastError: "offline",
		});
	});

	test("normalises already-added conflicts for generic-engine replay", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ code: "already-added" }), {
				status: 409,
				statusText: "Conflict",
			}),
		);
		const record = await queueAddToLibrary("series-1");
		const engine = createOutboxReplayEngine({
			handlers: {
				progress: async () => ({ status: 204 }),
				"add-to-library": replayAddToLibrary,
			},
			onAuthInvalid: vi.fn(),
		});

		await expect(engine.replay()).resolves.toMatchObject({ succeeded: 1 });
		expect(records.size).toBe(0);
		expect(record.id).toContain("library:series-1:");
	});

	test("lets the generic engine own auth invalidation", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{}", { status: 403 }),
		);
		await queueAddToLibrary("series-1");
		const onAuthInvalid = vi.fn();
		const engine = createOutboxReplayEngine({
			handlers: {
				progress: async () => ({ status: 204 }),
				"add-to-library": replayAddToLibrary,
			},
			onAuthInvalid,
		});

		await expect(engine.replay()).resolves.toMatchObject({ authInvalid: true });
		expect(onAuthInvalid).toHaveBeenCalledOnce();
		expect(records.size).toBe(1);
	});
});
