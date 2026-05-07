import type { ComicCacheMetadataInput } from "./comicCache.utils";
import type { DownloadActionCopy, DownloadActionCopyInput } from "./bulkDownload.types";

const ISSUE_PLURAL_RULES = new Intl.PluralRules("en");

/**
 * Returns the English noun form for an issue count.
 *
 * @param count - Number of issues being described.
 * @returns `issue` when the native plural category is `one`; otherwise `issues`.
 */
function pluralizeIssue(count: number): string {
  return ISSUE_PLURAL_RULES.select(count) === "one" ? "issue" : "issues";
}

/**
 * Builds the primary action copy for the bulk-download options menu.
 *
 * @param input - Current cache/download phase and issue counts.
 * @returns Label and supporting detail text for the action row.
 */
export function getDownloadActionCopy(input: DownloadActionCopyInput): DownloadActionCopy {
  const {
    phase,
    unreadIssueCount,
    missingIssueCount,
    completedCount,
    totalCount,
  } = input;

  if (phase === "checking") {
    return {
      label: "Checking cache",
      detail: "Looking for cached downloaded issues",
    };
  }

  if (phase === "downloading") {
    return {
      label: "Downloading unread issues",
      detail: `${completedCount} of ${totalCount} ${pluralizeIssue(totalCount)} complete`,
    };
  }

  if (unreadIssueCount === 0) {
    return {
      label: "No unread issues",
      detail: "There are no unread downloaded issues to cache",
    };
  }

  if (missingIssueCount === 0) {
    return {
      label: "Unread issues downloaded",
      detail: "All unread downloaded issues are cached",
    };
  }

  return {
    label: "Bulk download unread issues",
    detail: `${missingIssueCount} ${pluralizeIssue(missingIssueCount)} ready to cache`,
  };
}

/**
 * Formats an issue for compact progress text.
 *
 * @param issue - Issue metadata currently being cached.
 * @returns A display label such as `Saga #1`.
 */
export function formatIssueLabel(issue: ComicCacheMetadataInput): string {
  const issueNumber = issue.issueNumber != null ? ` #${issue.issueNumber}` : "";
  return `${issue.seriesName ?? "Comic"}${issueNumber}`;
}
