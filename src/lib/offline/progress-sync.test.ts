import { expiredSessionResponse } from "@util/mocks/expiredSession.mock";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OfflineProgressRecord } from "./types";

const records = vi.hoisted(() => new Map<string, OfflineProgressRecord>());

vi.mock("./database", () => ({
	isOfflineStorageSupported: () => true,
	offlineProgress: {
		getByStatus: async (status: OfflineProgressRecord["syncStatus"]) =>
			[...records.values()].filter((record) => record.syncStatus === status),
		countByStatus: async (status: OfflineProgressRecord["syncStatus"]) =>
			[...records.values()].filter((record) => record.syncStatus === status)
				.length,
		put: async (record: OfflineProgressRecord) => {
			records.set(record.issueId, record);
		},
		updateIfCurrent: async (
			issueId: string,
			isCurrent: (current: OfflineProgressRecord) => boolean,
			next: OfflineProgressRecord | null,
		) => {
			const current = records.get(issueId);
			if (!current || !isCurrent(current)) return false;
			if (next) records.set(issueId, next);
			else records.delete(issueId);
			return true;
		},
	},
}));

const fetchMock = vi.fn<typeof fetch>();

const pending: OfflineProgressRecord = {
	issueId: "issue/1",
	currentPage: 12,
	totalPages: 24,
	updatedAt: "2026-08-16T12:34:56.000Z",
	syncStatus: "pending",
};

function savedResponse(currentPage: number, updatedAt: string): Response {
	return Response.json({
		ok: true,
		applied: true,
		stale: false,
		current_page: currentPage,
		updated_at: updatedAt,
	});
}

/** Fresh module state (sync, backoff) and a fresh store for each test. */
async function loadSync() {
	vi.resetModules();
	const { $offline } = await import("@stores/offline.store");
	const sync = await import("./progress-sync");
	return { $offline, ...sync };
}

/** Lets a background sync pass run to completion. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

beforeEach(() => {
	records.clear();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("saveReadingProgress", () => {
	test("saves pending progress and pushes it straight away", async () => {
		const { saveReadingProgress } = await loadSync();
		fetchMock.mockResolvedValue(savedResponse(8, "2026-08-16T12:34:56.000Z"));

		const saved = await saveReadingProgress(
			{ issueId: "issue/1", currentPage: 8, totalPages: 20 },
			new Date("2026-08-16T13:34:56+01:00"),
		);

		expect(saved).toEqual({
			issueId: "issue/1",
			currentPage: 8,
			totalPages: 20,
			updatedAt: "2026-08-16T12:34:56.000Z",
			syncStatus: "pending",
		});
		await settle();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/comic/issue%2F1/progress",
			expect.objectContaining({
				method: "PATCH",
				keepalive: true,
				body: JSON.stringify({
					current_page: 8,
					total_pages: 20,
					updated_at: "2026-08-16T12:34:56.000Z",
				}),
			}),
		);
		expect(records.get("issue/1")?.syncStatus).toBe("synced");
	});

	test.each([
		[{ issueId: "", currentPage: 1, totalPages: 1 }, "issueId"],
		[{ issueId: "i", currentPage: 0, totalPages: 1 }, "currentPage"],
		[{ issueId: "i", currentPage: 1, totalPages: 0 }, "totalPages"],
		[{ issueId: "i", currentPage: 2, totalPages: 1 }, "cannot exceed"],
	] as const)("rejects invalid progress", async (input, message) => {
		const { saveReadingProgress } = await loadSync();

		await expect(saveReadingProgress(input)).rejects.toThrow(message);
		expect(records.size).toBe(0);
	});
});

describe("syncPendingProgress", () => {
	test("stores the server's newer progress from another device", async () => {
		const { syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		fetchMock.mockResolvedValue(
			Response.json({
				ok: true,
				applied: false,
				stale: true,
				current_page: 19,
				updated_at: "2026-08-16T13:00:00.000Z",
			}),
		);

		await syncPendingProgress();

		expect(records.get(pending.issueId)).toEqual({
			issueId: pending.issueId,
			currentPage: 19,
			totalPages: pending.totalPages,
			updatedAt: "2026-08-16T13:00:00.000Z",
			syncStatus: "synced",
		});
	});

	test("keeps a newer save made while the request was in flight", async () => {
		const { syncPendingProgress } = await loadSync();
		const newer = { ...pending, currentPage: 13 };
		records.set(pending.issueId, pending);
		fetchMock.mockImplementation(async () => {
			// Same timestamp, different page: only an exact match may settle.
			records.set(newer.issueId, newer);
			return savedResponse(pending.currentPage, pending.updatedAt);
		});

		await syncPendingProgress();

		expect(records.get(pending.issueId)).toEqual(newer);
	});

	test("marks rejected progress failed and counts it", async () => {
		const { $offline, syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		fetchMock.mockResolvedValue(new Response(null, { status: 422 }));

		await syncPendingProgress();

		expect(records.get(pending.issueId)).toMatchObject({
			syncStatus: "failed",
			lastError: "HTTP 422",
		});
		expect($offline.get()).toMatchObject({
			pendingProgress: 0,
			failedProgress: 1,
		});
	});

	test.each([
		401, 403, 408, 429, 503,
	])("keeps progress pending after HTTP %i", async (status) => {
		const { $offline, syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		fetchMock.mockResolvedValue(new Response(null, { status }));

		await syncPendingProgress();

		expect(records.get(pending.issueId)).toEqual(pending);
		expect($offline.get()).toMatchObject({
			pendingProgress: 1,
			authRequired: false,
		});
	});

	test("retries a malformed success response", async () => {
		const { syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		fetchMock.mockResolvedValue(Response.json({ ok: true }));

		await syncPendingProgress();

		expect(records.get(pending.issueId)).toEqual(pending);
	});

	test("stops and asks to sign in when the session expired", async () => {
		const { $offline, syncPendingProgress } = await loadSync();
		const other = { ...pending, issueId: "issue-2" };
		records.set(pending.issueId, pending);
		records.set(other.issueId, other);
		fetchMock.mockImplementation(async () => expiredSessionResponse());

		await syncPendingProgress();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect($offline.get().authRequired).toBe(true);
		expect(records.get(pending.issueId)).toEqual(pending);
		expect(records.get(other.issueId)).toEqual(other);
	});

	test("stops at the first network error", async () => {
		const { syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		records.set("issue-2", { ...pending, issueId: "issue-2" });
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

		await syncPendingProgress();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(records.get(pending.issueId)).toEqual(pending);
	});

	test("does not push while the browser is offline", async () => {
		const { syncPendingProgress } = await loadSync();
		vi.stubGlobal("navigator", { onLine: false });
		records.set(pending.issueId, pending);

		await syncPendingProgress();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("backs off between failed attempts and leaves saves to the retry", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { saveReadingProgress, syncPendingProgress } = await loadSync();
		records.set(pending.issueId, pending);
		fetchMock.mockImplementation(
			async () => new Response(null, { status: 503 }),
		);

		await syncPendingProgress();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await saveReadingProgress({
			issueId: pending.issueId,
			currentPage: 13,
			totalPages: 24,
		});
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5_000);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(9_999);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);

		fetchMock.mockImplementation(async () =>
			savedResponse(13, records.get(pending.issueId)?.updatedAt ?? ""),
		);
		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(records.get(pending.issueId)?.syncStatus).toBe("synced");
		expect(vi.getTimerCount()).toBe(0);
	});

	test("never rejects when storage fails, and retries later", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { syncPendingProgress } = await loadSync();
		const { offlineProgress } = await import("./database");
		vi.spyOn(offlineProgress, "getByStatus").mockRejectedValueOnce(
			new Error("IndexedDB unavailable"),
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(syncPendingProgress()).resolves.toBeUndefined();

		expect(vi.getTimerCount()).toBe(1);
	});
});

describe("discardFailedProgress", () => {
	test("drops failed progress but keeps a newer pending save", async () => {
		const { $offline, discardFailedProgress } = await loadSync();
		records.set("issue-1", {
			...pending,
			issueId: "issue-1",
			syncStatus: "failed",
		});
		records.set("issue-2", { ...pending, issueId: "issue-2" });

		await discardFailedProgress("issue-1");
		await discardFailedProgress("issue-2");

		expect(records.has("issue-1")).toBe(false);
		expect(records.get("issue-2")).toMatchObject({ syncStatus: "pending" });
		expect($offline.get()).toMatchObject({
			pendingProgress: 1,
			failedProgress: 0,
		});
	});
});
