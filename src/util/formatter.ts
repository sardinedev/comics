import type { Issue } from "./comics.types";
import type { MylarIssue, MylarComic } from "./mylar.types";

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
      issue.issueDate === "0000-00-00" ? "1900-01-01" : issue.issueDate,
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
