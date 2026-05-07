import type { ComicCacheMetadataInput } from "./comicCache.utils";

/** Props for the series-page bulk cache control. */
export type BulkDownloadProps = {
  /** Unread downloaded issues that are eligible to be added to the browser cache. */
  issues: ComicCacheMetadataInput[];
  /** All Mylar-downloaded issues used for the cached count denominator. */
  downloadedIssues: ComicCacheMetadataInput[];
};

/** UI phase for checking cache state or downloading unread issues. */
export type DownloadPhase = "checking" | "idle" | "downloading";

/** Text shown for the primary cache action inside the options menu. */
export type DownloadActionCopy = {
  label: string;
  detail: string;
};

export type DownloadActionCopyInput = {
  phase: DownloadPhase;
  unreadIssueCount: number;
  missingIssueCount: number;
  completedCount: number;
  totalCount: number;
};
