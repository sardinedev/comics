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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      get = (...args: any[]) => elasticState.get(...args);
      search = (...args: any[]) => elasticState.search(...args);
      update = (...args: any[]) => elasticState.update(...args);
    },
  };
});

const queries = await import("./queries");

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
                  { bool: { must_not: [{ exists: { field: "reading_state" } }] } },
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
