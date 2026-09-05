import type { Issue } from "@data/comics.types";
import { beforeEach, describe, expect, test, vi } from "vitest";

process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

const elasticState = {
	get: vi.fn(),
	search: vi.fn(),
	update: vi.fn(),
	openPointInTime: vi.fn(async () => ({ id: "snapshot-1" })),
	closePointInTime: vi.fn(async () => ({ succeeded: true })),
};

vi.mock("@elastic/elasticsearch", () => {
	return {
		Client: class {
			get = (...args: unknown[]) => elasticState.get(...args);
			search = (...args: unknown[]) => elasticState.search(...args);
			update = (...args: unknown[]) => elasticState.update(...args);
			openPointInTime = elasticState.openPointInTime;
			closePointInTime = elasticState.closePointInTime;
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
				sort: [
					{ issue_number: "asc" },
					{ issue_date: "asc" },
					{ issue_id: "asc" },
				],
			}),
		);
	});
});

describe("canonical series pagination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function seriesHits(count: number) {
		return Array.from({ length: count }, (_, index) => {
			const issueNumber = index + 1;
			const issueId = `issue-${String(issueNumber).padStart(4, "0")}`;
			return {
				_source: {
					...currentIssue,
					issue_id: issueId,
					issue_number: issueNumber,
					download_status: issueNumber === 1001 ? "Wanted" : "Downloaded",
				},
				sort: [issueNumber, Date.parse("2026-01-02"), issueId],
			};
		});
	}

	test("includes downloaded issues and preserves a gap beyond the first page", async () => {
		const hits = seriesHits(1002);
		elasticState.search
			.mockResolvedValueOnce({ hits: { hits: hits.slice(0, 1000) } })
			.mockResolvedValueOnce({ hits: { hits: hits.slice(1000) } });
		const result = await queries.getSeriesCacheManifest("series-1");
		expect(result.downloadedIssues).toHaveLength(1001);
		expect(result.downloadedIssues.at(-2)).toMatchObject({
			issue_id: "issue-1000",
			nextIssue: { issue_id: "issue-1001" },
		});
		expect(result.downloadedIssues.at(-1)).toMatchObject({
			issue_id: "issue-1002",
			previousIssue: { issue_id: "issue-1001" },
			nextIssue: null,
		});
		expect(result.unreadDownloadedIssueIds.has("issue-1002")).toBe(true);
		expect(elasticState.search).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				search_after: hits[999].sort,
				sort: [
					{ issue_number: "asc" },
					{ issue_date: "asc" },
					{ issue_id: "asc" },
				],
			}),
		);
	});

	test.each([
		1000, 1001,
	])("finds neighbors across the page boundary for issue %i", async (issueNumber) => {
		const hits = seriesHits(1002);
		elasticState.search
			.mockResolvedValueOnce({ hits: { hits: hits.slice(0, 1000) } })
			.mockResolvedValueOnce({ hits: { hits: hits.slice(1000) } });
		const result = await queries.getAdjacentSeriesIssueReferences({
			issue_id: `issue-${issueNumber}`,
			series_id: "series-1",
		});
		expect(result).toMatchObject({
			previousIssue: {
				issue_id: `issue-${String(issueNumber - 1).padStart(4, "0")}`,
			},
			nextIssue: { issue_id: `issue-${issueNumber + 1}` },
		});
	});

	test("uses the complete sort tuple when issue number and date are tied", async () => {
		const hits = seriesHits(1001).map((hit) => ({
			...hit,
			_source: { ...hit._source, issue_number: 1 },
			sort: [1, 0, hit._source.issue_id],
		}));
		elasticState.search
			.mockResolvedValueOnce({ hits: { hits: hits.slice(0, 1000) } })
			.mockResolvedValueOnce({ hits: { hits: hits.slice(1000) } });
		const result = await queries.getAdjacentSeriesIssueReferences({
			issue_id: "issue-1000",
			series_id: "series-1",
		});
		expect(result.nextIssue?.issue_id).toBe("issue-1001");
		expect(elasticState.search).toHaveBeenLastCalledWith(
			expect.objectContaining({ search_after: [1, 0, "issue-1000"] }),
		);
	});

	test("rejects a repeated cursor even when its array is a different instance", async () => {
		const hits = seriesHits(1000);
		elasticState.search
			.mockResolvedValueOnce({ hits: { hits } })
			.mockResolvedValueOnce({
				hits: { hits: hits.map((hit) => ({ ...hit, sort: [...hit.sort] })) },
			});
		await expect(queries.getSeriesCacheManifest("series-1")).rejects.toThrow(
			"Canonical series pagination did not advance",
		);
		expect(elasticState.search).toHaveBeenCalledTimes(2);
	});

	test("keeps pagination on the same snapshot and closes the latest snapshot ID", async () => {
		const hits = seriesHits(1002);
		elasticState.search
			.mockImplementationOnce(async (request) => {
				expect(request.pit).toEqual({ id: "snapshot-1", keep_alive: "1m" });
				expect(request).not.toHaveProperty("index");
				return { pit_id: "snapshot-2", hits: { hits: hits.slice(0, 1000) } };
			})
			.mockImplementationOnce(async (request) => {
				expect(request.pit).toEqual({ id: "snapshot-2", keep_alive: "1m" });
				return { pit_id: "snapshot-3", hits: { hits: hits.slice(1000) } };
			});
		const result = await queries.getAdjacentSeriesIssueReferences({
			issue_id: "issue-1000",
			series_id: "series-1",
		});
		expect(result.nextIssue?.issue_id).toBe("issue-1001");
		expect(elasticState.openPointInTime).toHaveBeenCalledWith({
			index: "issues",
			keep_alive: "1m",
		});
		expect(elasticState.closePointInTime).toHaveBeenCalledWith({
			id: "snapshot-3",
		});
	});

	test("closes the snapshot on search failure without masking the original error", async () => {
		const failure = new Error("search failed");
		elasticState.search.mockRejectedValueOnce(failure);
		elasticState.closePointInTime.mockRejectedValueOnce(
			new Error("close failed"),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await expect(queries.getSeriesCacheManifest("series-1")).rejects.toBe(
				failure,
			);
			expect(elasticState.closePointInTime).toHaveBeenCalledWith({
				id: "snapshot-1",
			});
			expect(errorSpy).toHaveBeenCalledOnce();
		} finally {
			errorSpy.mockRestore();
		}
	});

	test("finishes on an empty page when the series is an exact page multiple", async () => {
		elasticState.search
			.mockResolvedValueOnce({ hits: { hits: seriesHits(1000) } })
			.mockResolvedValueOnce({ hits: { hits: [] } });
		const result = await queries.getSeriesCacheManifest("series-1");
		expect(result.downloadedIssues).toHaveLength(1000);
		expect(result.downloadedIssues.at(-1)?.nextIssue).toBeNull();
		expect(elasticState.search).toHaveBeenCalledTimes(2);
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
				sort: [
					{ issue_number: "asc" },
					{ issue_date: "asc" },
					{ issue_id: "asc" },
				],
			}),
		);
	});
});

describe("updateReadingProgress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// `elasticState.update` is mocked: these tests verify the request/params/script
	// contract sent to Elasticsearch and how its result maps to `applied`, not the
	// real Painless comparison/state-transition semantics (which require a live ES).
	function updateRequest() {
		return elasticState.update.mock.calls[0][0] as {
			index: string;
			id: string;
			script: { source: string; params: Record<string, unknown> };
		};
	}

	test("sends the full progress-update script contract and params", async () => {
		elasticState.update.mockResolvedValue({ result: "updated" });

		await queries.updateReadingProgress("issue-2", {
			currentPage: 12,
			totalPages: 24,
			updatedAt: "2026-08-16T12:34:56.000Z",
			mutationId: "mutation-1",
		});

		const { index, id, script } = updateRequest();
		expect(index).toBe("issues");
		expect(id).toBe("issue-2");
		expect(script.params).toEqual({
			current_page: 12,
			total_pages: 24,
			updated_at: "2026-08-16T12:34:56.000Z",
			mutation_id: "mutation-1",
		});
		// Stale guard: a timestamp that is not strictly newer than the stored one is a no-op.
		expect(script.source).toMatch(
			/ctx\._source\.progress_updated_at != null && params\.updated_at\.compareTo\(ctx\._source\.progress_updated_at\) <= 0\) \{\s*\n\s*ctx\.op = 'noop';\s*\n\s*return;/,
		);
		// Required field writes.
		expect(script.source).toMatch(
			/ctx\._source\.current_page = params\.current_page;/,
		);
		expect(script.source).toMatch(
			/ctx\._source\.progress_updated_at = params\.updated_at;/,
		);
		expect(script.source).toMatch(
			/ctx\._source\.progress_mutation_id = params\.mutation_id;/,
		);
		expect(script.source).toMatch(
			/ctx\._source\.last_opened_at = params\.updated_at;/,
		);
		// Completion transition.
		expect(script.source).toMatch(
			/params\.total_pages > 0 && params\.current_page >= params\.total_pages\) \{\s*\n\s*ctx\._source\.reading_state = 'read';\s*\n\s*ctx\._source\.completed_at = params\.updated_at;/,
		);
		// In-progress transition clears any prior completion.
		expect(script.source).toMatch(
			/else if \(params\.current_page > 0\) \{\s*\n\s*ctx\._source\.reading_state = 'reading';\s*\n\s*ctx\._source\.completed_at = null;/,
		);
		// Start timestamp is only ever set once.
		expect(script.source).toMatch(
			/ctx\._source\.started_reading_at == null && params\.current_page > 0\) \{\s*\n\s*ctx\._source\.started_reading_at = params\.updated_at;/,
		);
	});

	test("maps an ES 'updated' result to applied: true with the request's timestamp", async () => {
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
	});

	test("maps an ES 'noop' result to applied: false, reflecting a stale/duplicate write", async () => {
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
	});
});
