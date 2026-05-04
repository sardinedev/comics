import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Icon } from "@components/Icon/Icon";
import {
  downloadIssueToCache,
  isIssueCached,
  type ComicCacheMetadataInput,
} from "./comicCache.utils";

/** Props for the series-page bulk cache control. */
type BulkDownloadProps = {
  /** Unread downloaded issues that are eligible to be added to the browser cache. */
  issues: ComicCacheMetadataInput[];
  /** All Mylar-downloaded issues used for the cached count denominator. */
  downloadedIssues: ComicCacheMetadataInput[];
};

/** UI phase for checking cache state or downloading unread issues. */
type DownloadPhase = "checking" | "idle" | "downloading";

/**
 * Formats an issue for compact progress text.
 *
 * @param issue - Issue metadata currently being cached.
 * @returns A display label such as `Saga #1`.
 */
function formatIssueLabel(issue: ComicCacheMetadataInput): string {
  const issueNumber = issue.issueNumber != null ? ` #${issue.issueNumber}` : "";
  return `${issue.seriesName ?? "Comic"}${issueNumber}`;
}

/**
 * Renders the series-page control for caching unread downloaded issues.
 *
 * The visible counter reflects all browser-cached downloaded issues, while the
 * action only downloads unread issues that are missing from the cache.
 */
export function BulkDownload({ issues, downloadedIssues }: BulkDownloadProps) {
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [failedIssues, setFailedIssues] = useState<ComicCacheMetadataInput[]>([]);
  const [phase, setPhase] = useState<DownloadPhase>("checking");
  const [activeIssue, setActiveIssue] = useState<ComicCacheMetadataInput | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [completedThisRun, setCompletedThisRun] = useState(0);
  const [totalThisRun, setTotalThisRun] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase("checking");
      const entries = await Promise.all(
        downloadedIssues.map(async (issue) => ({
          issueId: issue.issueId,
          cached: await isIssueCached(issue.issueId),
        })),
      );

      if (cancelled) return;
      setCachedIds(new Set(entries.filter((entry) => entry.cached).map((entry) => entry.issueId)));
      setPhase("idle");
    })();

    return () => {
      cancelled = true;
    };
  }, [downloadedIssues]);

  const missingIssues = useMemo(
    () => issues.filter((issue) => !cachedIds.has(issue.issueId)),
    [cachedIds, issues],
  );
  const cachedCount = downloadedIssues.filter((issue) => cachedIds.has(issue.issueId)).length;
  const isBusy = phase === "checking" || phase === "downloading";
  const runProgress = totalThisRun > 0
    ? Math.round(((completedThisRun + activeProgress) / totalThisRun) * 100)
    : 0;

  const downloadIssues = useCallback(async (targetIssues: ComicCacheMetadataInput[]) => {
    if (targetIssues.length === 0) return;

    setPhase("downloading");
    setFailedIssues([]);
    setCompletedThisRun(0);
    setTotalThisRun(targetIssues.length);

    const failures: ComicCacheMetadataInput[] = [];

    for (const issue of targetIssues) {
      setActiveIssue(issue);
      setActiveProgress(0);

      try {
        await downloadIssueToCache(
          issue.issueId,
          (ratio) => setActiveProgress(ratio),
          issue,
        );
        setCachedIds((current) => new Set(current).add(issue.issueId));
      } catch {
        failures.push(issue);
        setFailedIssues([...failures]);
      } finally {
        setCompletedThisRun((current) => current + 1);
      }
    }

    setActiveIssue(null);
    setActiveProgress(0);
    setPhase("idle");
  }, []);

  return (
    <div class="mt-5 flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label={`${cachedCount} of ${downloadedIssues.length} downloaded`}
          class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500"
        >
          <span class="text-amber-500">{cachedCount}</span>
          <span>/</span>
          <span>{downloadedIssues.length}</span>
          <span>downloaded</span>
        </div>

        <button
          type="button"
          class="inline-flex h-12 items-center gap-2 border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-amber-500 hover:text-amber-500 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
          disabled={isBusy || missingIssues.length === 0}
          onClick={() => void downloadIssues(missingIssues)}
        >
          <Icon name="sync" class="h-3.5 w-3.5" />
          {phase === "checking"
            ? "Checking"
            : issues.length === 0
              ? "No unread issues"
              : missingIssues.length === 0
              ? "Downloaded"
              : `Download ${missingIssues.length} unread issue${missingIssues.length === 1 ? "" : "s"}`}
        </button>

        {failedIssues.length > 0 && phase !== "downloading" && (
          <button
            type="button"
            class="inline-flex h-12 items-center gap-2 border border-red-900/80 bg-red-950 px-4 text-xs font-bold uppercase tracking-widest text-red-300 transition-colors hover:border-red-400 hover:text-red-200"
            onClick={() => void downloadIssues(failedIssues)}
          >
            Retry {failedIssues.length} issue{failedIssues.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {phase === "downloading" && (
        <div role="status" aria-live="polite" class="flex flex-col gap-2">
          <div class="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span class="truncate font-semibold text-slate-300">
              {activeIssue ? formatIssueLabel(activeIssue) : "Caching comics"}
            </span>
            <span class="font-semibold tabular-nums text-amber-500">
              {Math.min(100, Math.max(0, runProgress))}%
            </span>
          </div>
          <div
            class="h-1 overflow-hidden bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.max(0, runProgress))}
            aria-label="Bulk cache progress"
          >
            <div
              class="h-full bg-amber-500 transition-[width] duration-200"
              style={{ width: `${Math.min(100, Math.max(0, runProgress))}%` }}
            />
          </div>
        </div>
      )}

      {failedIssues.length > 0 && phase !== "downloading" && (
        <p role="alert" class="text-xs font-semibold text-red-400">
          Failed to cache {failedIssues.length} issue{failedIssues.length === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}
