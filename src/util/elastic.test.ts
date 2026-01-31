import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue, SeriesProgress } from "./comics.types";

const elasticState = {
  search: vi.fn(),
  mget: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
  return {
    Client: class {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      search = (...args: any[]) => elasticState.search(...args);
      mget = (...args: any[]) => elasticState.mget(...args);
      indices = {
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn(),
      };
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
    issue_reading_state: "unread",
    issue_artists: [],
    issue_writers: [],
    issue_cover_author: null,
    series_id: "s1",
    series_name: "Series",
    series_year: "2026",
    series_publisher: "Publisher",
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

function progressHitsResponse(progress: SeriesProgress[]) {
  return {
    hits: {
      hits: progress.map((p) => ({ _source: p })),
    },
  } as any;
}

function mgetResponse(issues: Issue[]) {
  return {
    docs: issues.map((issue) => ({ _id: issue.issue_id, _source: issue })),
  } as any;
}

afterEach(() => {
  elasticState.search.mockReset();
  elasticState.mget.mockReset();
});

describe("elasticGetUpNextIssues", () => {
  it("queries unread issues sorted by issue_date desc", async () => {
    elasticState.search.mockResolvedValueOnce(hitsResponse([]));

    await elastic.elasticGetUpNextIssues(5);

    expect(elasticState.search).toHaveBeenCalledTimes(1);
    const args = elasticState.search.mock.calls[0][0];
    expect(args.size).toBe(5);
    expect(args.query).toEqual({ term: { issue_reading_state: "unread" } });
    expect(args.sort).toEqual([{ issue_date: { order: "desc" } }]);
  });
});

describe("elasticGetContinueReadingIssues", () => {
  it("returns empty when series_progress has no docs", async () => {
    elasticState.search.mockResolvedValueOnce(progressHitsResponse([]));

    const result = await elastic.elasticGetContinueReadingIssues();
    expect(result).toEqual([]);
    expect(elasticState.search).toHaveBeenCalledTimes(1);
    expect(elasticState.mget).toHaveBeenCalledTimes(0);
  });

  it("returns current_issue_id or next_issue_id in progress order", async () => {
    const issueA5 = makeIssue({
      series_id: "A",
      series_name: "Alpha",
      issue_id: "A-5",
      issue_number: 5,
      issue_reading_state: "reading",
    });
    const issueB1 = makeIssue({
      series_id: "B",
      series_name: "Beta",
      issue_id: "B-1",
      issue_number: 1,
      issue_reading_state: "unread",
    });

    const progress: SeriesProgress[] = [
      {
        series_id: "A",
        series_name: "Alpha",
        current_issue_id: "A-5",
        current_issue_number: 5,
        last_activity_at: "2026-01-02T00:00:00.000Z",
      },
      {
        series_id: "B",
        series_name: "Beta",
        next_issue_id: "B-1",
        next_issue_number: 1,
        last_activity_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    elasticState.search.mockResolvedValueOnce(progressHitsResponse(progress));
    elasticState.mget.mockResolvedValueOnce(mgetResponse([issueA5, issueB1]));

    const result = await elastic.elasticGetContinueReadingIssues({ maxSeries: 10 });
    expect(result.map((i) => i.issue_id)).toEqual(["A-5", "B-1"]);
    expect(elasticState.search).toHaveBeenCalledTimes(1);
    expect(elasticState.mget).toHaveBeenCalledTimes(1);
  });
});
