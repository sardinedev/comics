import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComicvineIssues,
  ComicvineResponse,
  ComicvineSingleIssueResponse,
  ComicvineVolume,
} from "./comicvine.types";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

function mockComicvineResponse<T>(
  results: T,
  statusCode: number = 1,
  totalResults?: number
): ComicvineResponse<T> {
  return {
    error: "OK",
    limit: 100,
    offset: 0,
    number_of_page_results: Array.isArray(results) ? results.length : 1,
    number_of_total_results: totalResults ?? (Array.isArray(results) ? results.length : 1),
    status_code: statusCode,
    results,
  };
}

function mockFetchResponse<T = unknown>(data: T, status: number = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("getWeeklyComics", () => {
  it("fetches weekly comics with correct date range filter", async () => {
    const mockIssues: ComicvineIssues[] = [
      {
        id: 1,
        issue_number: "1",
        name: "Issue 1",
        volume: { id: 100, name: "Test Series" },
      } as ComicvineIssues,
      {
        id: 2,
        issue_number: "2",
        name: "Issue 2",
        volume: { id: 100, name: "Test Series" },
      } as ComicvineIssues,
    ];

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockIssues, 1, 2))
    );

    const { getWeeklyComics } = await import("./comicvine");
    const result = await getWeeklyComics("2026-01-01", "2026-01-07");

    expect(result.totalResults).toBe(2);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].id).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("filter=store_date:2026-01-01|2026-01-07"),
      expect.objectContaining({
        headers: { "User-Agent": "marabyte.com" },
      })
    );
  });

  it("includes User-Agent header", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse([] as ComicvineIssues[]))
    );

    const { getWeeklyComics } = await import("./comicvine");
    await getWeeklyComics("2026-01-01", "2026-01-07");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "User-Agent": "marabyte.com" },
      })
    );
  });

  it("throws error when API returns non-OK status code", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(
        {
          ...mockComicvineResponse([] as ComicvineIssues[], 100),
          error: "Invalid API Key",
        },
        200
      )
    );

    const { getWeeklyComics } = await import("./comicvine");
    await expect(
      getWeeklyComics("2026-01-01", "2026-01-07")
    ).rejects.toThrow("Fetching weekly comics");
  });

  it("throws error when fetch fails with HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({}, 500)
    );

    const { getWeeklyComics } = await import("./comicvine");
    await expect(
      getWeeklyComics("2026-01-01", "2026-01-07")
    ).rejects.toThrow("responded with HTTP status 500");
  });
});

describe("getComicIssueDetails", () => {
  it("fetches single issue details by ID", async () => {
    const mockIssue: ComicvineSingleIssueResponse = {
      id: 12345,
      issue_number: "42",
      name: "The Answer",
      cover_date: "2026-01-15",
      store_date: "2026-01-10",
      volume: { id: 100, name: "Test Series" },
    } as ComicvineSingleIssueResponse;

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockIssue))
    );

    const { getComicIssueDetails } = await import("./comicvine");
    const result = await getComicIssueDetails(12345);

    expect(result.id).toBe(12345);
    expect(result.issue_number).toBe("42");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("issue/4000-12345"),
      expect.any(Object)
    );
  });

  it("accepts string IDs", async () => {
    const mockIssue: ComicvineSingleIssueResponse = {
      id: 99999,
      issue_number: "1",
    } as ComicvineSingleIssueResponse;

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockIssue))
    );

    const { getComicIssueDetails } = await import("./comicvine");
    await getComicIssueDetails("99999");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("issue/4000-99999"),
      expect.any(Object)
    );
  });

  it("throws error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({}, 404)
    );

    const { getComicIssueDetails } = await import("./comicvine");
    await expect(
      getComicIssueDetails(12345)
    ).rejects.toThrow("Error fetching comic issue details");
  });
});

describe("getVolumeDetails", () => {
  it("fetches volume details by ID", async () => {
    const mockVolume: ComicvineVolume = {
      id: 5000,
      name: "Daredevil: The Man Without Fear",
      start_year: "1993",
      count_of_issues: 5,
      publisher: { id: 31, name: "Marvel" },
    } as ComicvineVolume;

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockVolume))
    );

    const { getVolumeDetails } = await import("./comicvine");
    const result = await getVolumeDetails(5000);

    expect(result.id).toBe(5000);
    expect(result.name).toBe("Daredevil: The Man Without Fear");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("volume/4050-5000"),
      expect.any(Object)
    );
  });

  it("accepts string IDs", async () => {
    const mockVolume: ComicvineVolume = {
      id: 999,
      name: "Test",
    } as ComicvineVolume;

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockVolume))
    );

    const { getVolumeDetails } = await import("./comicvine");
    await getVolumeDetails("999");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("volume/4050-999"),
      expect.any(Object)
    );
  });

  it("throws error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({}, 404)
    );

    const { getVolumeDetails } = await import("./comicvine");
    await expect(
      getVolumeDetails(5000)
    ).rejects.toThrow("Error fetching comic volume details");
  });
});

describe("getIssuesFromVolume", () => {
  it("fetches issues for a volume with default offset", async () => {
    const mockIssues: ComicvineIssues[] = [
      { id: 1, issue_number: "1", name: "First" } as ComicvineIssues,
      { id: 2, issue_number: "2", name: "Second" } as ComicvineIssues,
    ];

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse(mockIssues))
    );

    const { getIssuesFromVolume } = await import("./comicvine");
    const result = await getIssuesFromVolume(100);

    expect(result).toHaveLength(2);
    expect(result?.[0].id).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/filter=volume:100.*sort=cover_date:asc.*offset=0/),
      expect.any(Object)
    );
  });

  it("uses custom offset for pagination", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse([] as ComicvineIssues[]))
    );

    const { getIssuesFromVolume } = await import("./comicvine");
    await getIssuesFromVolume(100, 50);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("offset=50"),
      expect.any(Object)
    );
  });

  it("accepts string volume IDs", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse([] as ComicvineIssues[]))
    );

    const { getIssuesFromVolume } = await import("./comicvine");
    await getIssuesFromVolume("999");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("filter=volume:999"),
      expect.any(Object)
    );
  });

  it("returns undefined when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({}, 500)
    );

    const { getIssuesFromVolume } = await import("./comicvine");
    const result = await getIssuesFromVolume(100);

    expect(result).toBeUndefined();
  });

  it("sorts issues by cover_date ascending", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(mockComicvineResponse([] as ComicvineIssues[]))
    );

    const { getIssuesFromVolume } = await import("./comicvine");
    await getIssuesFromVolume(100);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("sort=cover_date:asc"),
      expect.any(Object)
    );
  });
});
