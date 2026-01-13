import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "./comics.types";

const elasticState = {
  search: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
  return {
    Client: class {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      search = (...args: any[]) => elasticState.search(...args);
    },
  };
});

const elastic = await import("./elastic");

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    issue_id: "1",
    issue_name: "Issue",
    issue_number: 1,
    issue_date: "2026-01-01",
    issue_status: "Downloaded",
    issue_cover: "https://example.com/cover.jpg",
    issue_read: false,
    issue_artists: [],
    issue_writers: [],
    issue_cover_author: null,
    series_id: "s1",
    series_name: "Series",
    series_year: "2026",
    series_publisher: "Publisher",
    series_reading_status: "unread",
    ...overrides,
  };
}

function hitsResponse(issues: Issue[]) {
  return {
    hits: {
      hits: issues.map((issue) => ({ _source: issue })),
    },
  } as any;
}

afterEach(() => {
  elasticState.search.mockReset();
});

describe("elasticGetUpNextIssues", () => {
  it("queries unread issues sorted by issue_date desc", async () => {
    elasticState.search.mockResolvedValueOnce(hitsResponse([]));

    await elastic.elasticGetUpNextIssues(5);

    expect(elasticState.search).toHaveBeenCalledTimes(1);
    const args = elasticState.search.mock.calls[0][0];
    expect(args.size).toBe(5);
    expect(args.query).toEqual({ term: { issue_read: false } });
    expect(args.sort).toEqual([{ issue_date: { order: "desc" } }]);
  });
});

describe("elasticGetContinueReadingIssues", () => {
  it("returns empty when there are no read issues", async () => {
    elasticState.search.mockResolvedValueOnce(hitsResponse([]));

    const result = await elastic.elasticGetContinueReadingIssues();
    expect(result).toEqual([]);
    expect(elasticState.search).toHaveBeenCalledTimes(1);
  });

  it("picks the first unread issue after the max read per series", async () => {
    const seriesARead = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_read: true,
      issue_number: 2,
      issue_id: "A-2",
    });
    const seriesBRead = makeIssue({
      series_id: "B",
      series_name: "Beta",
      issue_read: true,
      issue_number: 5,
      issue_id: "B-5",
    });

    const unreadA3 = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_read: false,
      issue_number: 3,
      issue_id: "A-3",
    });
    const unreadB6 = makeIssue({
      series_id: "B",
      series_name: "Beta",
      issue_read: false,
      issue_number: 6,
      issue_id: "B-6",
    });

    elasticState.search
      .mockResolvedValueOnce(hitsResponse([seriesBRead, seriesARead]))
      .mockResolvedValueOnce(hitsResponse([unreadA3, unreadB6]));

    const result = await elastic.elasticGetContinueReadingIssues({
      maxSeries: 10,
    });

    expect(result.map((i) => i.issue_id).sort()).toEqual(["A-3", "B-6"]);
    expect(elasticState.search).toHaveBeenCalledTimes(2);
  });

  it("falls back to the earliest unread when none are after max read", async () => {
    const seriesARead = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_read: true,
      issue_number: 5,
      issue_id: "A-5",
    });

    const unreadA1 = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_read: false,
      issue_number: 1,
      issue_id: "A-1",
    });
    const unreadA2 = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_read: false,
      issue_number: 2,
      issue_id: "A-2",
    });

    elasticState.search
      .mockResolvedValueOnce(hitsResponse([seriesARead]))
      .mockResolvedValueOnce(hitsResponse([unreadA1, unreadA2]));

    const result = await elastic.elasticGetContinueReadingIssues();
    expect(result.map((i) => i.issue_id)).toEqual(["A-1"]);
    expect(elasticState.search).toHaveBeenCalledTimes(2);
  });
});
