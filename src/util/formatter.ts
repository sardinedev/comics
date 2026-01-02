import type { Issue } from "./comics.types";
import type { MylarIssue, MylarComic } from "./mylar.types";
import type { ComicvineSingleIssueResponse } from "./comicvine.types";
import { getCoverUrl } from "./covers";

/**
 * Formats a Mylar issue into an Issue object.
 *
 * By default, the issue is marked as unread. If the issue date is not available, it is set to "1900-01-01".
 * 
 * Cover URL logic:
 * - Downloaded issues: use local path `/covers/{id}.jpg` (cover will be extracted from CBZ)
 * - Non-downloaded issues: use the ComicVine URL from imageURL (browser will fetch directly)
 * 
 * @param issue An object representing a Mylar issue.
 * @param series The series this issue belongs to.
 * @returns An Issue object.
 */
export function formatMylarIssue(issue: MylarIssue, series: MylarComic): Issue {
  // For downloaded issues, use local cover path
  // For non-downloaded issues, use ComicVine URL (browser can fetch it)
  const isDownloaded = issue.status === "Downloaded";
  const coverUrl = isDownloaded ? getCoverUrl(issue.id) : issue.imageURL;

  return {
    issue_artists: [],
    issue_cover: coverUrl,
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
    issue_read: false,
    issue_writers: [],
    series_id: String(issue.volume.id),
    series_name: issue.volume.name,
    series_reading_status: "unread",
  };
}
