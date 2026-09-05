import type { Issue } from "@data/comics.types";
import { beforeEach, describe, expect, test, vi } from "vitest";

process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

const elasticState = {
	get: vi.fn(),
	search: vi.fn(),
	update: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
	return {
		Client: class {
			get = (...args: unknown[]) => elasticState.get(...args);
			search = (...args: unknown[]) => elasticState.search(...args);
			update = (...args: unknown[]) => elasticState.update(...args);
		},
	};
});

const queries = await import("./queries");

const currentIssue: Issue = {
	issue_id: "issue-2",
	series_id: "series-1",
	issue_number: 2,
	issue_date: "2026-01-02",
	download_status: "Downloaded",
	synced_at: "2026-01-01T00:00:00.000Z",
};

const nextIssue: Issue = {
	issue_id: "issue-3",
	series_id: "series-1",
	issue_number: 3,
	issue_date: "2026-01-03",
	download_status: "Downloaded",
	synced_at: "2026-01-01T00:00:00.000Z",
};

describe("getIssue", () => {
	test("preserves optional lookups while allowing strict callers to handle failures", async () => {
		const failure = new Error("Elasticsearch unavailable");
		elasticState.get.mockRejectedValueOnce(failure);
		await expect(queries.getIssue("issue-1")).resolves.toBeNull();
		elasticState.get.mockRejectedValueOnce(failure);
		await expect(
			queries.getIssue("issue-1", { throwOnError: true }),
		).rejects.toBe(failure);
	});
});

describe("getSeriesCacheManifest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("uses server order and preserves gaps around downloaded issues", async () => {
		elasticState.search.mockResolvedValueOnce({
			hits: {
				hits: [
					{
						_source: {
							...currentIssue,
							issue_id: "issue-1",
							issue_number: 1,
							series_name: "Saga",
							series_year: "2012",
							reading_state: "unread",
						},
					},
					{
						_source: {
							...currentIssue,
							issue_id: "issue-gap",
							issue_number: 1.5,
							download_status: "Wanted",
						},
					},
					{
						_source: {
							...currentIssue,
							issue_id: "issue-2",
							issue_number: 2,
							series_name: "Saga",
							series_year: "2012",
							reading_state: "read",
						},
					},
				],
			},
		});

		const result = await queries.getSeriesCacheManifest("series-1");

		expect(result.downloadedIssues).toEqual([
			expect.objectContaining({
				issue_id: "issue-1",
				previousIssue: null,
				nextIssue: expect.objectContaining({ issue_id: "issue-gap" }),
			}),
			expect.objectContaining({
				issue_id: "issue-2",
				previousIssue: expect.objectContaining({ issue_id: "issue-gap" }),
				nextIssue: null,
			}),
		]);
		expect([...result.unreadDownloadedIssueIds]).toEqual(["issue-1"]);
		expect(elasticState.search).toHaveBeenCalledWith(
			expect.objectContaining({
				query: { term: { series_id: "series-1" } },
				sort: [{ issue_number: "asc" }, { issue_date: "asc" }],
			}),
		);
	});
});

describe("getDownloadedSeriesIssues", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("fetches all downloaded issues for cache status", async () => {
		elasticState.search.mockResolvedValue({
			hits: {
				hits: [
					{
						_source: {
							issue_id: "i1",
							series_id: "s1",
							series_name: "Saga",
							series_year: "2012",
							issue_number: 1,
							issue_name: "One",
							issue_date: "2026-01-01",
							issue_cover_url: "/covers/i1.jpg",
							issue_cover_thumb_hash: "thumb",
						},
					},
				],
			},
		});

		const issues = await queries.getDownloadedSeriesIssues("s1");

		expect(issues).toHaveLength(1);
		expect(elasticState.search).toHaveBeenCalledWith({
			index: "issues",
			size: 1000,
			query: {
				bool: {
					filter: [
						{ term: { series_id: "s1" } },
						{ term: { download_status: "Downloaded" } },
					],
				},
			},
			sort: [{ issue_number: "asc" }],
			_source: [
				"issue_id",
				"series_id",
				"series_name",
				"series_year",
				"issue_number",
				"issue_name",
				"issue_date",
				"issue_cover_url",
				"issue_cover_thumb_hash",
			],
		});
	});
});

describe("getUnreadDownloadedSeriesIssues", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("fetches unread downloaded issues for cache metadata", async () => {
		elasticState.search.mockResolvedValue({
			hits: {
				hits: [
					{
						_source: {
							issue_id: "i1",
							series_id: "s1",
							series_name: "Saga",
							series_year: "2012",
							issue_number: 1,
							issue_name: "One",
							issue_date: "2026-01-01",
							issue_cover_url: "/covers/i1.jpg",
							issue_cover_thumb_hash: "thumb",
						},
					},
				],
			},
		});

		const issues = await queries.getUnreadDownloadedSeriesIssues("s1");

		expect(issues).toEqual([
			{
				issue_id: "i1",
				series_id: "s1",
				series_name: "Saga",
				series_year: "2012",
				issue_number: 1,
				issue_name: "One",
				issue_date: "2026-01-01",
				issue_cover_url: "/covers/i1.jpg",
				issue_cover_thumb_hash: "thumb",
			},
		]);
		expect(elasticState.search).toHaveBeenCalledWith({
			index: "issues",
			size: 1000,
			query: {
				bool: {
					filter: [
						{ term: { series_id: "s1" } },
						{ term: { download_status: "Downloaded" } },
						{
							bool: {
								should: [
									{ term: { reading_state: "unread" } },
									{
										bool: {
											must_not: [{ exists: { field: "reading_state" } }],
										},
									},
								],
								minimum_should_match: 1,
							},
						},
					],
				},
			},
			sort: [{ issue_number: "asc" }],
			_source: [
				"issue_id",
				"series_id",
				"series_name",
				"series_year",
				"issue_number",
				"issue_name",
				"issue_date",
				"issue_cover_url",
				"issue_cover_thumb_hash",
			],
		});
	});
});

describe("getNextDownloadedIssue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("fetches the next downloaded issue in the same series", async () => {
		elasticState.search.mockResolvedValueOnce({
			hits: { hits: [{ _source: nextIssue }] },
		});

		const result = await queries.getNextDownloadedIssue(currentIssue);

		expect(result).toBe(nextIssue);
		expect(elasticState.search).toHaveBeenCalledWith({
			index: "issues",
			size: 1,
			query: {
				bool: {
					filter: [
						{ term: { series_id: "series-1" } },
						{ term: { download_status: "Downloaded" } },
						{ range: { issue_number: { gt: 2 } } },
					],
				},
			},
			sort: [{ issue_number: "asc" }, { issue_date: "asc" }],
		});
	});

	test("returns null when there is no downloaded next issue", async () => {
		elasticState.search.mockResolvedValueOnce({ hits: { hits: [] } });

		await expect(
			queries.getNextDownloadedIssue(currentIssue),
		).resolves.toBeNull();
	});
});

describe("getAdjacentSeriesIssueReferences", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("returns neighbours from server ordering without download filtering", async () => {
		elasticState.search.mockResolvedValueOnce({
			hits: {
				hits: [
					{
						_source: { ...currentIssue, issue_id: "issue-1", issue_number: 1 },
					},
					{ _source: currentIssue },
					{
						_source: {
							...nextIssue,
							download_status: "Wanted",
						},
					},
				],
			},
		});

		await expect(
			queries.getAdjacentSeriesIssueReferences(currentIssue),
		).resolves.toEqual({
			previousIssue: {
				issue_id: "issue-1",
				issue_number: 1,
				issue_name: undefined,
			},
			nextIssue: {
				issue_id: "issue-3",
				issue_number: 3,
				issue_name: undefined,
			},
		});
		expect(elasticState.search).toHaveBeenCalledWith(
			expect.objectContaining({
				query: { term: { series_id: "series-1" } },
				sort: [{ issue_number: "asc" }, { issue_date: "asc" }],
			}),
		);
	});
});

describe("updateReadingProgress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("applies a strictly newer timestamp and stores its mutation id", async () => {
		elasticState.update.mockResolvedValue({ result: "updated" });

		await expect(
			queries.updateReadingProgress("issue-2", {
				currentPage: 12,
				totalPages: 24,
				updatedAt: "2026-08-16T12:34:56.000Z",
				mutationId: "mutation-1",
			}),
		).resolves.toEqual({
			applied: true,
			updatedAt: "2026-08-16T12:34:56.000Z",
		});

		expect(elasticState.update).toHaveBeenCalledWith({
			index: "issues",
			id: "issue-2",
			script: {
				source: expect.stringMatching(
					/progress_updated_at.*compareTo\(ctx\._source\.progress_updated_at\) <= 0/s,
				),
				params: {
					current_page: 12,
					total_pages: 24,
					updated_at: "2026-08-16T12:34:56.000Z",
					mutation_id: "mutation-1",
				},
			},
		});
	});

	test("reports equal or older timestamps as stale when Elasticsearch no-ops", async () => {
		elasticState.update.mockResolvedValue({ result: "noop" });

		await expect(
			queries.updateReadingProgress("issue-2", {
				currentPage: 8,
				totalPages: 24,
				updatedAt: "2026-08-16T12:34:56.000Z",
				mutationId: "mutation-replay",
			}),
		).resolves.toEqual({
			applied: false,
			updatedAt: "2026-08-16T12:34:56.000Z",
		});

		const source = elasticState.update.mock.calls[0][0].script.source as string;
		expect(source).toContain("ctx.op = 'noop'");
		expect(source).toContain("ctx._source.progress_mutation_id");
		expect(source).toContain("ctx._source.last_opened_at = params.updated_at");
	});
});
