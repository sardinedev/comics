import type { IssueStatus } from "./mylar.types";

export type ReadingStatus = "read" | "unread" | "reading";

/**
 * An issue is a single comic book, magazine, or other publication.
 */
export type Issue = {
  /** The unique identifier for the issue, same as the Comicvine ID */
  issue_id: string;
  /** The name of the issue */
  issue_name: string | null;
  /** The issue number */
  issue_number: number;
  /** The date when the issue was released, in the format YYYY-MM-DD */
  issue_date: string;
  /** The status of the issue */
  issue_status: IssueStatus;
  /** An URL to the cover image of the issue */
  issue_cover: string;
  /** Has the issue been read? */
  issue_read: boolean;
  /** Artists that worked on the issue */
  issue_artists: string[];
  /** Writers that worked on the issue */
  issue_writers: string[];
  /** Cover author */
  issue_cover_author: string | null;
  /** The unique identifier for the series, same as the Comicvine ID */
  series_id: string;
  /** The name of the series */
  series_name: string;
  /** The year when the series started, in the format YYYY */
  series_year: string;
  /** The publisher of the series */
  series_publisher: string;
  /** Reading status */
  series_reading_status: ReadingStatus;
};

/**
 * A series is a collection of issues.
 */
export type Series = {
  /** The unique identifier for the series, same as the Comicvine ID */
  series_id: string;
  /** The name of the series */
  series_name: string;
  /** The year when the series started, in the format YYYY */
  series_year: string;
  /** The publisher of the series */
  series_publisher: string;
  /** Reading status */
  series_reading_status: ReadingStatus;
};

/**
 * A series update is a partial update to a series.
 */
export type SeriesUpdate = Partial<Series>;
