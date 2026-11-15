import { beforeEach, describe, expect, test, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
	getIssue: vi.fn(),
	mylarDownloadIssue: vi.fn(),
}));

vi.mock("@data/elastic/queries", () => ({
	getIssue: queryMocks.getIssue,
}));
vi.mock("@data/mylar/mylar", () => ({
	mylarDownloadIssue: queryMocks.mylarDownloadIssue,
}));

const { GET } = await import("./download");

beforeEach(() => {
	vi.clearAllMocks();
	queryMocks.getIssue.mockResolvedValue({
		issue_id: "issue-1",
		download_status: "Downloaded",
	});
});

function getIssue() {
	return GET({
		params: { id: "issue-1" },
	} as unknown as Parameters<typeof GET>[0]);
}

describe("download API issue lookup", () => {
	test("returns 404 when the issue is missing", async () => {
		queryMocks.getIssue.mockResolvedValue(null);

		const response = await getIssue();

		expect(response.status).toBe(404);
		expect(queryMocks.mylarDownloadIssue).not.toHaveBeenCalled();
	});

	test("logs lookup failures and returns a retryable error", async () => {
		const failure = new Error("Elasticsearch unavailable");
		queryMocks.getIssue.mockRejectedValue(failure);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		try {
			const response = await getIssue();

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ error: "Failed to load issue" });
			expect(queryMocks.mylarDownloadIssue).not.toHaveBeenCalled();
			expect(consoleError).toHaveBeenCalledWith(
				"Failed to load issue for download:",
				failure,
			);
		} finally {
			consoleError.mockRestore();
		}
	});
});
