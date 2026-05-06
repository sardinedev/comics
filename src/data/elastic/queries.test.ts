import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Issue } from "../comics.types";

const elasticState = vi.hoisted(() => ({
  search: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./elastic", () => ({
  elastic: elasticState,
}));

const { getNextDownloadedIssue } = await import("./queries");

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

describe("getNextDownloadedIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("fetches the next downloaded issue in the same series", async () => {
    elasticState.search.mockResolvedValueOnce({
      hits: { hits: [{ _source: nextIssue }] },
    });

    const result = await getNextDownloadedIssue(currentIssue);

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

    await expect(getNextDownloadedIssue(currentIssue)).resolves.toBeNull();
  });
});
