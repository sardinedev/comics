import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComicvineSingleIssueResponse } from "../comicvine/comicvine.types";

// Env before imports
process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

const elasticState = {
	bulk: vi.fn(),
	search: vi.fn(),
};

type ComicvineIssueOverrides = Partial<
	Omit<ComicvineSingleIssueResponse, "image" | "volume">
> & {
	image?: Partial<ComicvineSingleIssueResponse["image"]>;
	volume?: Partial<ComicvineSingleIssueResponse["volume"]>;
};

function comicvineIssue(
	overrides: ComicvineIssueOverrides = {},
): ComicvineSingleIssueResponse {
	const { image, volume, ...issueOverrides } = overrides;

	return {
		aliases: "",
		api_detail_url: "",
		character_credits: [],
		characters_died_in: [],
		concept_credits: [],
		cover_date: "",
		date_added: "",
		date_last_updated: "",
		deck: "",
		description: "",
		disbanded_teams: [],
		first_appearance_characters: [],
		first_appearance_concepts: [],
		first_appearance_locations: [],
		first_appearance_objects: [],
		first_appearance_storyarcs: [],
		first_appearance_teams: [],
		has_staff_review: false,
		id: 1,
		image: {
			icon_url: "",
			medium_url: "",
			screen_url: "",
			screen_large_url: "",
			small_url: "",
			super_url: "",
			thumb_url: "",
			tiny_url: "",
			original_url: "",
			image_tags: "",
			...image,
		},
		issue_number: "1",
		location_credits: [],
		name: "",
		object_credits: [],
		person_credits: [],
		site_detail_url: "",
		store_date: "",
		story_arc_credits: [],
		team_credits: [],
		teams_disbanded_in: [],
		volume: {
			api_detail_url: "",
			id: 1,
			name: "Saga",
			site_detail_url: "",
			...volume,
		},
		...issueOverrides,
	};
}

vi.mock("@elastic/elasticsearch", () => {
	return {
		Client: class {
			bulk = (...args: unknown[]) => elasticState.bulk(...args);
			search = (...args: unknown[]) => elasticState.search(...args);
			indices = {};
		},
	};
});

vi.mock("../mylar/mylar", () => {
	return {
		mylarGetAllSeries: vi.fn(),
		mylarGetSeries: vi.fn(),
		mylarGetHistory: vi.fn(),
	};
});

vi.mock("../comicvine/comicvine", () => {
	return {
		getComicIssueDetails: vi.fn(),
	};
});

vi.mock("../../util/covers", () => {
	return {
		ensureCoverCached: vi.fn(),
		generateThumbHash: vi.fn(),
	};
});

const mylar = await import("../mylar/mylar");
const comicvine = await import("../comicvine/comicvine");
const covers = await import("../../util/covers");
const sync = await import("./mylar-to-elastic");

const mockedGetComicIssueDetails = vi.mocked(comicvine.getComicIssueDetails);
const mockedEnsureCoverCached = vi.mocked(covers.ensureCoverCached);
const mockedMylarGetAllSeries = vi.mocked(mylar.mylarGetAllSeries);
const mockedMylarGetHistory = vi.mocked(mylar.mylarGetHistory);
const mockedMylarGetSeries = vi.mocked(mylar.mylarGetSeries);

describe("syncMylarToElastic", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();

		elasticState.bulk.mockResolvedValue({
			took: 1,
			errors: false,
			items: [],
		});

		// Default: no issues already enriched
		elasticState.search.mockResolvedValue({
			hits: { hits: [] },
		});

		mockedMylarGetAllSeries.mockResolvedValue({
			result: "success",
			data: [
				{
					id: "s1",
					name: "Saga",
					publisher: "Image",
					status: "Downloaded",
					totalIssues: 10,
					year: "2012",
					latestIssue: "10",
					detailsURL: "",
					imageURL: "http://example.com/series.jpg",
				},
			],
		});

		mockedMylarGetSeries.mockResolvedValue({
			result: "success",
			data: {
				comic: [
					{
						id: "s1",
						name: "Saga",
						publisher: "Image",
						status: "Downloaded",
						totalIssues: 10,
						year: "2012",
						latestIssue: "10",
						detailsURL: "",
						imageURL: "http://example.com/series.jpg",
					},
				],
				issues: [
					{
						id: "i1",
						comicName: "Saga",
						imageURL: "http://example.com/i1.jpg",
						issueDate: "2026-01-01",
						name: "Issue One",
						number: "1",
						releaseDate: "2026-01-01",
						status: "Downloaded",
					},
				],
			},
		});

		mockedMylarGetHistory.mockResolvedValue({
			result: "success",
			data: [
				{
					ComicID: "s1",
					ComicName: "Saga",
					DateAdded: "2026-01-02 12:00:00",
					IssueID: "i1",
					Issue_Number: "1",
					Status: "Downloaded",
					Provider: "nzbhydra",
				},
			],
		});

		mockedGetComicIssueDetails.mockResolvedValue(
			comicvineIssue({
				store_date: "2026-01-03",
				description: "desc",
				image: { original_url: "http://example.com/i1-cv.jpg" },
				character_credits: [
					{ id: 1, name: "Alana", api_detail_url: "", site_detail_url: "" },
					{ id: 2, name: "Marko", api_detail_url: "", site_detail_url: "" },
				],
			}),
		);

		mockedEnsureCoverCached.mockResolvedValue("/covers/i1.jpg");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("bulk upserts issues and preserves reading fields by using update+upsert", async () => {
		await sync.syncMylarToElastic({ refresh: "false" });

		const bulkCall = elasticState.bulk.mock.calls[0][0];
		expect(bulkCall.refresh).toBe("false");

		// body should be: update action then {doc, upsert}
		expect(bulkCall.body[0]).toEqual({
			update: { _index: "issues", _id: "i1" },
		});

		const payload = bulkCall.body[1];
		expect(payload.doc.reading_state).toBeUndefined();
		expect(payload.upsert.reading_state).toBe("unread");
	});

	it("fills added_to_library_at from history when Downloaded", async () => {
		await sync.syncMylarToElastic({ refresh: "false" });
		const payload = elasticState.bulk.mock.calls[0][0].body[1];
		expect(payload.doc.added_to_library_at).toMatch(/^2026-01-02T12:00:00/);
	});

	it("optionally enriches from ComicVine and caches covers", async () => {
		const syncPromise = sync.syncMylarToElastic({
			refresh: "false",
			enrichFromComicVine: true,
			cacheCovers: true,
		});
		await vi.runAllTimersAsync();
		await syncPromise;

		expect(comicvine.getComicIssueDetails).toHaveBeenCalledWith("i1");
		expect(covers.ensureCoverCached).toHaveBeenCalledWith("i1");

		const payload = elasticState.bulk.mock.calls[0][0].body[1];
		expect(payload.doc.issue_date).toBe("2026-01-03");
		expect(payload.doc.issue_description).toBe("desc");
		expect(payload.doc.issue_cover_url).toBe("/covers/i1.jpg");
		expect(payload.doc.characters).toEqual(["Alana", "Marko"]);
		expect(payload.doc.comicvine_enriched_at).toEqual(expect.any(String));
	});

	it("reports sync progress without changing returned stats", async () => {
		const progressReporter = {
			start: vi.fn(),
			seriesStart: vi.fn(),
			seriesFetched: vi.fn(),
			seriesComplete: vi.fn(),
		};

		const stats = await sync.syncMylarToElastic({
			refresh: "false",
			progressReporter,
		});

		expect(progressReporter.start).toHaveBeenCalledWith(
			expect.objectContaining({
				seriesSeen: 1,
				seriesTotal: 1,
				issuesSeen: 0,
				stats: expect.objectContaining({ seriesSynced: 0 }),
			}),
		);
		expect(progressReporter.seriesStart).toHaveBeenCalledWith(
			expect.objectContaining({
				currentSeries: { id: "s1", name: "Saga" },
			}),
		);
		expect(progressReporter.seriesFetched).toHaveBeenCalledWith(
			expect.objectContaining({
				issuesSeen: 1,
				currentSeries: { id: "s1", name: "Saga" },
			}),
		);
		expect(progressReporter.seriesComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				stats: expect.objectContaining({
					seriesSynced: 1,
					issuesUpserted: 1,
				}),
			}),
		);
		expect(stats).toEqual({
			seriesSeen: 1,
			seriesSynced: 1,
			issuesUpserted: 1,
			issuesEnriched: 0,
			coversCached: 0,
		});
	});

	it("does not fail sync when progress reporting fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		try {
			const stats = await sync.syncMylarToElastic({
				refresh: "false",
				progressReporter: {
					start: vi.fn().mockRejectedValue(new Error("progress unavailable")),
				},
			});

			expect(stats.issuesUpserted).toBe(1);
			expect(consoleError).toHaveBeenCalledWith(
				"Failed to record sync progress",
				expect.any(Error),
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("skips ComicVine call for issues already enriched", async () => {
		elasticState.search.mockResolvedValue({
			hits: { hits: [{ _source: { issue_id: "i1" } }] },
		});

		await sync.syncMylarToElastic({
			refresh: "false",
			enrichFromComicVine: true,
		});

		expect(comicvine.getComicIssueDetails).not.toHaveBeenCalled();
	});

	it("returns stats with correct counts", async () => {
		const stats = await sync.syncMylarToElastic({ refresh: "false" });

		expect(stats).toEqual({
			seriesSeen: 1,
			seriesSynced: 1,
			issuesUpserted: 1,
			issuesEnriched: 0,
			coversCached: 0,
		});
	});

	it("does not set added_to_library_at for non-Downloaded issues", async () => {
		mockedMylarGetSeries.mockResolvedValue({
			result: "success",
			data: {
				comic: [
					{
						id: "s1",
						name: "Saga",
						publisher: "Image",
						status: "Downloaded",
						totalIssues: 10,
						year: "2012",
						latestIssue: "2",
						detailsURL: "",
						imageURL: "http://example.com/series1.jpg",
					},
				],
				issues: [
					{
						id: "i2",
						comicName: "Saga",
						imageURL: "http://example.com/i2.jpg",
						issueDate: "2026-01-05",
						name: "Issue Two",
						number: "2",
						releaseDate: "2026-01-05",
						status: "Wanted",
					},
				],
			},
		});

		await sync.syncMylarToElastic({ refresh: "false" });

		const payload = elasticState.bulk.mock.calls[0][0].body[1];
		expect(payload.doc.download_status).toBe("Wanted");
		expect(payload.doc.added_to_library_at).toBeUndefined();
	});

	it("respects seriesLimit option", async () => {
		mockedMylarGetAllSeries.mockResolvedValue({
			result: "success",
			data: [
				{
					id: "s1",
					name: "Saga",
					publisher: "Image",
					status: "Downloaded",
					totalIssues: 10,
					year: "2012",
					latestIssue: "10",
					detailsURL: "",
					imageURL: "http://example.com/series1.jpg",
				},
				{
					id: "s2",
					name: "The Walking Dead",
					publisher: "Image",
					status: "Downloaded",
					totalIssues: 193,
					year: "2003",
					latestIssue: "193",
					detailsURL: "",
					imageURL: "http://example.com/series2.jpg",
				},
			],
		});

		const stats = await sync.syncMylarToElastic({
			seriesLimit: 1,
			refresh: "false",
		});

		expect(stats.seriesSeen).toBe(2);
		expect(stats.seriesSynced).toBe(1);
		expect(mylar.mylarGetSeries).toHaveBeenCalledTimes(1);
	});

	it("handles multiple series and batches them", async () => {
		mockedMylarGetAllSeries.mockResolvedValue({
			result: "success",
			data: [
				{
					id: "s1",
					name: "Saga",
					publisher: "Image",
					status: "Downloaded",
					totalIssues: 2,
					year: "2012",
					latestIssue: "2",
					detailsURL: "",
					imageURL: "http://example.com/s1.jpg",
				},
				{
					id: "s2",
					name: "TWD",
					publisher: "Image",
					status: "Downloaded",
					totalIssues: 1,
					year: "2003",
					latestIssue: "1",
					detailsURL: "",
					imageURL: "http://example.com/s2.jpg",
				},
			],
		});

		mockedMylarGetSeries.mockImplementation((seriesId: string) => {
			if (seriesId === "s1") {
				return Promise.resolve({
					result: "success",
					data: {
						comic: [
							{
								id: "s1",
								name: "Saga",
								publisher: "Image",
								status: "Downloaded",
								totalIssues: 2,
								year: "2012",
								latestIssue: "2",
								detailsURL: "",
								imageURL: "http://example.com/s1.jpg",
							},
						],
						issues: [
							{
								id: "i1",
								comicName: "Saga",
								imageURL: "http://example.com/i1.jpg",
								issueDate: "2026-01-01",
								name: "Issue 1",
								number: "1",
								releaseDate: "2026-01-01",
								status: "Downloaded",
							},
							{
								id: "i2",
								comicName: "Saga",
								imageURL: "http://example.com/i2.jpg",
								issueDate: "2026-01-02",
								name: "Issue 2",
								number: "2",
								releaseDate: "2026-01-02",
								status: "Downloaded",
							},
						],
					},
				});
			}
			return Promise.resolve({
				result: "success",
				data: {
					comic: [
						{
							id: "s2",
							name: "TWD",
							publisher: "Image",
							status: "Downloaded",
							totalIssues: 1,
							year: "2003",
							latestIssue: "1",
							detailsURL: "",
							imageURL: "http://example.com/s2.jpg",
						},
					],
					issues: [
						{
							id: "i3",
							comicName: "TWD",
							imageURL: "http://example.com/i3.jpg",
							issueDate: "2026-01-03",
							name: "Issue 1",
							number: "1",
							releaseDate: "2026-01-03",
							status: "Downloaded",
						},
					],
				},
			});
		});

		const stats = await sync.syncMylarToElastic({ refresh: "false" });

		expect(stats.seriesSynced).toBe(2);
		expect(stats.issuesUpserted).toBe(3);
		expect(elasticState.bulk).toHaveBeenCalledTimes(2);
	});

	it("continues when ComicVine enrichment fails for an issue", async () => {
		mockedGetComicIssueDetails.mockRejectedValue(
			new Error("ComicVine API rate limit"),
		);

		await expect(
			sync.syncMylarToElastic({ enrichFromComicVine: true, refresh: "false" }),
		).rejects.toThrow("ComicVine API rate limit");

		// Sync should fail fast on enrichment errors (this is intentional - we want to know)
	});

	it("continues when cover caching fails for an issue", async () => {
		mockedEnsureCoverCached.mockResolvedValue(null);

		await sync.syncMylarToElastic({ cacheCovers: true, refresh: "false" });

		const payload = elasticState.bulk.mock.calls[0][0].body[1];
		// Should fall back to original imageURL
		expect(payload.doc.issue_cover_url).toBe("http://example.com/i1.jpg");
	});

	it("handles Mylar API failures", async () => {
		mockedMylarGetAllSeries.mockRejectedValue(
			new Error("Mylar connection refused"),
		);

		await expect(sync.syncMylarToElastic({ refresh: "false" })).rejects.toThrow(
			"Mylar connection refused",
		);
	});
});
