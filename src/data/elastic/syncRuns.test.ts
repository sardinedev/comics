import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

const elasticState = {
	index: vi.fn(),
	update: vi.fn(),
	search: vi.fn(),
	count: vi.fn(),
	indices: {
		exists: vi.fn(),
		create: vi.fn(),
		putMapping: vi.fn(),
	},
};

vi.mock("@elastic/elasticsearch", () => {
	return {
		Client: class {
			index = (...args: unknown[]) => elasticState.index(...args);
			update = (...args: unknown[]) => elasticState.update(...args);
			search = (...args: unknown[]) => elasticState.search(...args);
			count = (...args: unknown[]) => elasticState.count(...args);
			indices = elasticState.indices;
		},
	};
});

function syncRun(overrides = {}) {
	return {
		run_id: "run-1",
		kind: "enrichment",
		status: "running",
		started_at: "2026-05-10T00:00:00.000Z",
		updated_at: "2026-05-10T00:00:00.000Z",
		enrich_from_comicvine: true,
		cache_covers: true,
		series_seen: 2,
		series_total: 2,
		series_synced: 1,
		issues_seen: 10,
		issues_upserted: 5,
		issues_enriched: 4,
		covers_cached: 3,
		...overrides,
	};
}

describe("syncRuns", () => {
	let syncRuns: typeof import("./syncRuns");

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();

		elasticState.indices.exists.mockResolvedValue(false);
		elasticState.indices.create.mockResolvedValue({ acknowledged: true });
		elasticState.index.mockResolvedValue({ result: "created" });
		elasticState.update.mockResolvedValue({ result: "updated" });
		elasticState.search.mockResolvedValue({ hits: { hits: [] } });
		elasticState.count.mockResolvedValue({ count: 0 });

		syncRuns = await import("./syncRuns");
	});

	it("creates a running sync run document", async () => {
		const run = await syncRuns.createSyncRun({
			kind: "enrichment",
			enrichFromComicVine: true,
			cacheCovers: true,
			seriesLimit: 5,
		});

		expect(elasticState.indices.create).toHaveBeenCalledWith(
			expect.objectContaining({ index: "sync_runs" }),
		);
		expect(elasticState.index).toHaveBeenCalledWith({
			index: "sync_runs",
			id: run.run_id,
			document: expect.objectContaining({
				run_id: run.run_id,
				kind: "enrichment",
				status: "running",
				enrich_from_comicvine: true,
				cache_covers: true,
				series_limit: 5,
				series_synced: 0,
				issues_enriched: 0,
			}),
			refresh: "wait_for",
		});
	});

	it("maps progress snapshots to sync-run updates", async () => {
		const reporter = syncRuns.createSyncRunProgressReporter("run-1");

		await reporter.issueEnriched?.({
			seriesSeen: 4,
			seriesTotal: 2,
			issuesSeen: 25,
			enrichFromComicVine: true,
			cacheCovers: false,
			seriesLimit: 2,
			currentSeries: { id: "s1", name: "Saga" },
			currentIssue: { id: "i1", number: "1", name: "Issue One" },
			stats: {
				seriesSeen: 4,
				seriesSynced: 1,
				issuesUpserted: 20,
				issuesEnriched: 3,
				coversCached: 0,
			},
		});

		expect(elasticState.update).toHaveBeenCalledWith({
			index: "sync_runs",
			id: "run-1",
			doc: expect.objectContaining({
				enrich_from_comicvine: true,
				cache_covers: false,
				series_limit: 2,
				series_seen: 4,
				series_total: 2,
				series_synced: 1,
				issues_seen: 25,
				issues_upserted: 20,
				issues_enriched: 3,
				covers_cached: 0,
				current_series_id: "s1",
				current_series_name: "Saga",
				current_issue_id: "i1",
				current_issue_number: "1",
				current_issue_name: "Issue One",
				updated_at: expect.any(String),
			}),
		});
	});

	it("marks runs completed and failed", async () => {
		await syncRuns.completeSyncRun("run-1", {
			seriesSeen: 4,
			seriesSynced: 2,
			issuesUpserted: 20,
			issuesEnriched: 3,
			coversCached: 8,
		});

		expect(elasticState.update).toHaveBeenLastCalledWith({
			index: "sync_runs",
			id: "run-1",
			doc: expect.objectContaining({
				status: "completed",
				series_seen: 4,
				series_total: 2,
				issues_upserted: 20,
				issues_enriched: 3,
				covers_cached: 8,
				current_series_id: null,
				current_issue_id: null,
				last_error: null,
			}),
		});

		await syncRuns.failSyncRun("run-1", new Error("ComicVine rate limit"));

		expect(elasticState.update).toHaveBeenLastCalledWith({
			index: "sync_runs",
			id: "run-1",
			doc: expect.objectContaining({
				status: "failed",
				last_error: "ComicVine rate limit",
			}),
		});
	});

	it("returns enrichment coverage and marks stale running jobs", async () => {
		elasticState.count
			.mockResolvedValueOnce({ count: 10 })
			.mockResolvedValueOnce({ count: 4 });
		elasticState.search.mockResolvedValue({
			hits: { hits: [{ _source: syncRun() }] },
		});

		const snapshot = await syncRuns.getEnrichmentMonitorSnapshot(
			new Date("2026-05-10T00:11:00.000Z"),
		);

		expect(snapshot.overview).toEqual({
			totalIssues: 10,
			enrichedIssues: 4,
			pendingIssues: 6,
			percentComplete: 40,
			staleAfterSeconds: 600,
			generatedAt: "2026-05-10T00:11:00.000Z",
		});
		expect(snapshot.latestRun?.run_id).toBe("run-1");
		expect(snapshot.isLatestRunStale).toBe(true);
		expect(elasticState.count).toHaveBeenNthCalledWith(2, {
			index: "issues",
			query: {
				bool: {
					should: [
						{ exists: { field: "comicvine_enriched_at" } },
						{ exists: { field: "characters" } },
					],
					minimum_should_match: 1,
				},
			},
		});
	});
});
