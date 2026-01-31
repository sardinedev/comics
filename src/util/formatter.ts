import type { Issue } from "./comics.types";
import type { MylarIssue, MylarComic } from "../data/mylar/mylar.types";
import type { ComicvineSingleIssueResponse } from "../data/comicvine/comicvine.types";

/**
 * Formats a Mylar issue into an Issue object.
 *
 * By default, the issue is marked as unread. If the issue date is not available, it is set to "1900-01-01".
 *
 * Cover URL logic:
 * - This formatter always sets `issue_cover` to the ComicVine URL from `imageURL`.
 * - If an issue is downloaded, sync/backfill will attempt to cache a local cover and then update
 *   Elasticsearch to point `issue_cover` at `/covers/{id}.jpg` only once the file exists.
 *
 * @param issue An object representing a Mylar issue.
 * @param series The series this issue belongs to.
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
    issue_reading_state: "unread",
    issue_status: issue.status,
    issue_writers: [],
    series_id: series.id,
    series_name: series.name,
    series_publisher: series.publisher,
    series_year: series.year,
  };
}

/**
 * Formats a Comicvine issue into an Issue object.
 * @param issue An object representing a Comicvine issue.
 * @returns An Issue object.
 */
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
    issue_reading_state: "unread",
    issue_writers: [],
    series_id: String(issue.volume.id),
    series_name: issue.volume.name,
  };
}
