import type { Issue } from "./comics.types";
import type { MylarIssue, MylarComic } from "./mylar.types";
import type { ComicvineSingleIssueResponse } from "./comicvine.types";

/**
 * Formats a Mylar issue into an Issue object.
 *
 * By default, the issue is marked as unread. If the issue date is not available, it is set to "1900-01-01".
 * @param issue An object representing a Mylar issue.
 * @returns An Issue object.
 */
export function formatMylarIssue(issue: MylarIssue, series: MylarComic): Issue {
  return {
    issue_artists: [],
    issue_cover: issue.imageURL,
    issue_cover_author: null,
    issue_date:
      issue.releaseDate === "0000-00-00" ? "1900-01-01" : issue.releaseDate,
    issue_id: issue.id,
    issue_name: issue.name,
    issue_number: Number(issue.number),
    issue_read: false,
    issue_status: issue.status,
    issue_writers: [],
    series_id: series.id,
    series_name: series.name,
    series_publisher: series.publisher,
    series_reading_status: "unread",
    series_year: series.year,
  };
}

export function formatComicvineIssue(
  issue: ComicvineSingleIssueResponse
): Partial<Issue> {
  return {
    issue_artists: [],
    issue_cover: issue.image.original_url,
    issue_cover_author: null,
    issue_date: issue.store_date,
    issue_id: String(issue.id),
    issue_name: issue.name,
    issue_number: Number(issue.issue_number),
    issue_read: false,
    issue_writers: [],
    series_id: String(issue.volume.id),
    series_name: issue.volume.name,
    series_reading_status: "unread",
  };
}
