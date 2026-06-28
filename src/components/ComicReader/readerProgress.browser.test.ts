import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	deleteReaderProgress,
	listUnsyncedReaderProgress,
	markReaderProgressSynced,
	READER_PROGRESS_STORAGE_KEY,
	readReaderProgress,
	resolveInitialReaderPage,
	saveReaderProgress,
	syncPendingReaderProgress,
	syncReaderProgress,
} from "./readerProgress";

beforeEach(() => {
	localStorage.removeItem(READER_PROGRESS_STORAGE_KEY);
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem(READER_PROGRESS_STORAGE_KEY);
});

describe("reader progress", () => {
	test("saves local progress and prefers unsynced local progress", () => {
		saveReaderProgress("issue-1", 4, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});

		expect(readReaderProgress("issue-1")).toMatchObject({
			issueId: "issue-1",
			currentPage: 4,
			totalPages: 24,
		});
		expect(resolveInitialReaderPage("issue-1", 2)).toBe(4);
		expect(listUnsyncedReaderProgress()).toHaveLength(1);
	});

	test("uses server progress once local progress is synced", () => {
		saveReaderProgress("issue-1", 4, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});
		markReaderProgressSynced("issue-1", "2026-06-22T10:00:01.000Z");

		expect(resolveInitialReaderPage("issue-1", 2)).toBe(2);
		expect(resolveInitialReaderPage("issue-1", 0)).toBe(4);
		expect(resolveInitialReaderPage("issue-1", 2, { preferStored: true })).toBe(
			4,
		);
		expect(listUnsyncedReaderProgress()).toHaveLength(0);
	});

	test("keeps the synced marker when the same progress is saved again", () => {
		saveReaderProgress("issue-1", 4, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});
		const synced = markReaderProgressSynced(
			"issue-1",
			"2026-06-22T10:00:01.000Z",
		);

		saveReaderProgress("issue-1", 4, 24, {
			updatedAt: "2026-06-22T10:00:02.000Z",
		});

		expect(readReaderProgress("issue-1")?.syncedAt).toBe(synced?.syncedAt);
		expect(listUnsyncedReaderProgress()).toHaveLength(0);
	});

	test("marks changed progress unsynced", () => {
		saveReaderProgress("issue-1", 4, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});
		markReaderProgressSynced("issue-1", "2026-06-22T10:00:01.000Z");

		saveReaderProgress("issue-1", 5, 24, {
			updatedAt: "2026-06-22T10:00:02.000Z",
		});

		expect(readReaderProgress("issue-1")?.syncedAt).toBeUndefined();
		expect(listUnsyncedReaderProgress()).toHaveLength(1);
	});

	test("syncs pending progress to the progress API", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ ok: true }), { status: 200 }),
			);
		saveReaderProgress("issue/1", 5, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});

		await expect(syncReaderProgress("issue/1")).resolves.toBe(true);

		expect(fetchSpy).toHaveBeenCalledWith("/api/comic/issue%2F1/progress", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ current_page: 5, total_pages: 24 }),
		});
		expect(listUnsyncedReaderProgress()).toHaveLength(0);
	});

	test("keeps progress unsynced while offline", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		saveReaderProgress("issue-1", 6, 24, {
			updatedAt: "2026-06-22T10:00:00.000Z",
		});

		await expect(syncPendingReaderProgress()).resolves.toBe(0);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(listUnsyncedReaderProgress()).toHaveLength(1);
	});

	test("deletes and ignores corrupted progress entries", () => {
		saveReaderProgress("issue-1", 3, 24);
		expect(deleteReaderProgress("issue-1")).toBe(true);
		expect(readReaderProgress("issue-1")).toBeNull();

		localStorage.setItem(READER_PROGRESS_STORAGE_KEY, "not-json");
		expect(readReaderProgress("issue-1")).toBeNull();
		expect(resolveInitialReaderPage("issue-1", 2)).toBe(2);
	});
});
