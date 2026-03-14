import type { IssueStatus, MylarComic, MylarIssue } from "./mylar/mylar.types";

/**
 * Reading state for an issue in the user's library.
 */
export type ReadingState = "unread" | "reading" | "read";

/**
 * Full issue document shape as stored in Elasticsearch.
 *
 * This is the complete type for reading issues from the index in the UI.
 * Includes all metadata from sync PLUS user's reading state.
 */
export type Issue = {
  // === IDENTITY ===
  /** The unique identifier for the issue from ComicVine */
  issue_id: MylarIssue["id"];
  /** The unique identifier for the series from ComicVine */
  series_id: MylarComic["id"];

  // === ISSUE DETAILS ===
  /** The issue number (supports fractional issues like 1.1, 2.5) */
  issue_number: number;
  /** The name/title of the issue */
  issue_name?: MylarIssue["name"];
  /** Full description of the issue (enriched from ComicVine) */
  issue_description?: string;
  /** Release date in ISO format YYYY-MM-DD */
  issue_date: string;
  /** URL to the issue's cover image (local cache or remote) */
  issue_cover_url?: string;
  /** Total number of pages in the issue */
  issue_page_count?: number;

  // === CREATORS ===
  /** List of writers who worked on this issue */
  writers?: string[];
  /** List of artists who worked on this issue */
  artists?: string[];
  /** List of colorists who worked on this issue */
  colorists?: string[];
  /** List of letterers who worked on this issue */
  letterers?: string[];
  /** List of cover artists who worked on this issue */
  cover_artists?: string[];
  /** List of editors who worked on this issue */
  editors?: string[];

  // === SERIES DATA (denormalized) ===
  /** The name of the series this issue belongs to */
  series_name?: MylarComic["name"];
  /** Full description of the series */
  series_description?: string;
  /** The year when the series started, in format YYYY */
  series_year?: MylarComic["year"];
  /** The publisher of the series */
  series_publisher?: MylarComic["publisher"];
  /** URL to the series cover image */
  series_cover_url?: string;
  /** Total number of issues in the series */
  series_total_issues?: MylarComic["totalIssues"];
  /** Status of the series (ongoing, completed, cancelled) */
  series_status?: string;

  // === STORY ARCS ===
  /** List of story arc IDs this issue belongs to */
  story_arc_ids?: string[];

  // === MYLAR STATUS ===
  /** Download/library status from Mylar (Wanted, Downloaded, Skipped, etc.) */
  download_status?: IssueStatus;
  /** File path where the issue is stored on disk */
  mylar_file_location?: string;
  /** ISO timestamp when the issue was added to the library (first Downloaded) */
  added_to_library_at?: string;

  // === READING STATE (user data) ===
  /** User's reading state for this issue */
  reading_state?: ReadingState;
  /** ISO timestamp when the user started reading this issue */
  started_reading_at?: string;
  /** ISO timestamp when the user last opened this issue */
  last_opened_at?: string;
  /** ISO timestamp when the user completed reading this issue */
  completed_at?: string;
  /** Current page number the user is on (for resuming reading) */
  current_page?: number;
  /** Whether the user has marked this issue as a favorite */
  is_favorite?: boolean;
  /** User's rating for this issue (1-5 stars) */
  user_rating?: number;

  // === METADATA ===
  /** ISO timestamp when this document was last synced from Mylar */
  synced_at: string;
};
