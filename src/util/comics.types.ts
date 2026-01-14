import type { IssueStatus } from "./mylar.types";

/**
 * Per-issue reading state.
 *
 * - unread: never opened / not started
 * - reading: opened but not finished
 * - read: finished (last page) or manually marked
 */
export type IssueReadingState = "unread" | "reading" | "read";

/**
 * An issue is a single comic book, magazine, or other publication.
 */
export type Issue = {
  /** Unique issue identifier (ComicVine issue ID as string). */
  issue_id: string;
  /** Issue title/name (may be null/unknown from upstream). */
  issue_name: string | null;
  /** Issue number within the series (numeric). */
  issue_number: number;
  /** Release/store date in `YYYY-MM-DD` format. */
  issue_date: string;
  /** Library/download status from Mylar (e.g. Downloaded/Wanted/Skipped). */
  issue_status: IssueStatus;
  /** Cover image URL (ComicVine URL or local `/covers/...` route once cached). */
  issue_cover: string;
  /** Reading state for this issue. */
  issue_reading_state: IssueReadingState;
  /** Last opened timestamp as ISO string (set by reader/open event). */
  issue_last_opened_at?: string;
  /** When the issue was marked read as ISO string (set by last-page/manual). */
  issue_read_at?: string;
  /** Artists credited for the issue. */
  issue_artists: string[];
  /** Writers credited for the issue. */
  issue_writers: string[];
  /** Cover artist/author credit (if known). */
  issue_cover_author: string | null;
  /** Unique series identifier (ComicVine volume/series ID as string). */
  series_id: string;
  /** Series name/title. */
  series_name: string;
  /** Series start year in `YYYY` format. */
  series_year: string;
  /** Publisher name for the series (if known). */
  series_publisher: string;
};

/**
 * Per-series progress document for "Continue reading".
 *
 * Stored separately from issues to make the homepage query cheap.
 */
export type SeriesProgress = {
  /** Unique series identifier (ComicVine volume/series ID as string). */
  series_id: string;
  /** Series name/title. */
  series_name: string;
  /** Series start year in `YYYY` format (if known/available). */
  series_year?: string;
  /** Publisher name for the series (if known/available). */
  series_publisher?: string;
  /** Representative series cover URL (e.g. a recent issue cover). */
  series_cover?: string;
  /** Issue ID currently in `reading` state for this series (at most one). */
  current_issue_id?: string;
  /** Issue number for `current_issue_id` (denormalized for sorting/display). */
  current_issue_number?: number;
  /** Next issue ID after `last_read_*` in strict order (may be undefined). */
  next_issue_id?: string;
  /** Issue number for `next_issue_id` (denormalized for sorting/display). */
  next_issue_number?: number;
  /** Download/library status for `next_issue_id` (if known). */
  next_issue_download_status?: IssueStatus;
  /** Most recently completed (read) issue ID for this series (if any). */
  last_read_issue_id?: string;
  /** Issue number for `last_read_issue_id` (denormalized). */
  last_read_issue_number?: number;
  /** Last activity timestamp (open/reading/read) as ISO string. */
  last_activity_at: string;
  /** Last completed-read timestamp as ISO string (if any). */
  last_read_at?: string;
};
