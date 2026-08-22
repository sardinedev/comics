import { beforeEach, describe, expect, test, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
	getIssue: vi.fn(),
	updateReadingProgress: vi.fn(),
}));

vi.mock("@data/elastic/queries", () => queryMocks);

const { PATCH, POST, handleProgress } = await import("./progress");

const validBody = {
	current_page: 12,
	total_pages: 24,
	updated_at: "2026-08-16T12:34:56.000Z",
	mutation_id: "progress-device-a-123",
};

function request(body: unknown): Request {
	return new Request("http://localhost/api/comic/issue-1/progress", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	queryMocks.getIssue.mockResolvedValue({ issue_id: "issue-1" });
	queryMocks.updateReadingProgress.mockResolvedValue({
		applied: true,
		updatedAt: validBody.updated_at,
	});
});

describe("progress API validation", () => {
	test("rejects malformed JSON and non-object bodies", async () => {
		const malformed = new Request("http://localhost", {
			method: "PATCH",
			body: "{",
		});
		expect((await handleProgress("issue-1", malformed)).status).toBe(400);
		expect((await handleProgress("issue-1", request([]))).status).toBe(400);
	});

	test.each([
		[{ ...validBody, current_page: 0 }, "current_page"],
		[{ ...validBody, current_page: 1.5 }, "current_page"],
		[{ ...validBody, total_pages: 0 }, "total_pages"],
		[{ ...validBody, total_pages: 2.5 }, "total_pages"],
		[{ ...validBody, current_page: 25 }, "cannot exceed"],
		[{ ...validBody, updated_at: "2026-08-16" }, "updated_at"],
		[{ ...validBody, updated_at: "not-a-date" }, "updated_at"],
		[{ ...validBody, mutation_id: "" }, "mutation_id"],
		[{ ...validBody, mutation_id: "x".repeat(201) }, "mutation_id"],
	] as const)("rejects invalid progress fields", async (body, message) => {
		const response = await handleProgress("issue-1", request(body));

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: expect.stringContaining(message),
		});
		expect(queryMocks.getIssue).not.toHaveBeenCalled();
	});

	test("returns 404 without attempting an update when the issue is missing", async () => {
		queryMocks.getIssue.mockResolvedValue(null);

		const response = await handleProgress("missing", request(validBody));

		expect(response.status).toBe(404);
		expect(queryMocks.updateReadingProgress).not.toHaveBeenCalled();
	});
});

describe("progress API writes", () => {
	test("normalizes the timestamp and reports an applied update", async () => {
		const response = await handleProgress(
			"issue-1",
			request({
				...validBody,
				updated_at: "2026-08-16T13:34:56+01:00",
			}),
		);

		expect(queryMocks.updateReadingProgress).toHaveBeenCalledWith("issue-1", {
			currentPage: 12,
			totalPages: 24,
			updatedAt: "2026-08-16T12:34:56.000Z",
			mutationId: validBody.mutation_id,
		});
		expect(await response.json()).toEqual({
			ok: true,
			applied: true,
			stale: false,
			current_page: validBody.current_page,
			updated_at: validBody.updated_at,
		});
	});

	test("returns authoritative server progress for an ignored timestamp", async () => {
		queryMocks.getIssue
			.mockResolvedValueOnce({ issue_id: "issue-1" })
			.mockResolvedValueOnce({
				issue_id: "issue-1",
				current_page: 19,
				progress_updated_at: "2026-08-16T13:00:00.000Z",
			});
		queryMocks.updateReadingProgress.mockResolvedValue({
			applied: false,
			updatedAt: validBody.updated_at,
		});

		const response = await handleProgress("issue-1", request(validBody));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			applied: false,
			stale: true,
			current_page: 19,
			updated_at: "2026-08-16T13:00:00.000Z",
		});
	});

	test("returns 500 when Elasticsearch rejects the update", async () => {
		queryMocks.updateReadingProgress.mockRejectedValue(
			new Error("unavailable"),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const response = await handleProgress("issue-1", request(validBody));

		expect(response.status).toBe(500);
		consoleError.mockRestore();
	});

	test.each([
		[PATCH, "PATCH"],
		[POST, "POST"],
	] as const)("supports %s route calls", async (route, method) => {
		const response = await route({
			params: { id: "issue-1" },
			request: new Request("http://localhost", {
				method,
				body: JSON.stringify(validBody),
			}),
		} as unknown as Parameters<typeof route>[0]);

		expect(response.status).toBe(200);
	});
});
