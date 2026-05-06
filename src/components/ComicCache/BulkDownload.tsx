import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "@components/Icon/Icon";
import {
  downloadIssueToCache,
  isIssueCached,
  type ComicCacheMetadataInput,
} from "./comicCache.utils";
import {
  formatIssueLabel,
  getDownloadActionCopy,
} from "./bulkDownload.utils";
import type { BulkDownloadProps, DownloadPhase } from "./bulkDownload.types";

/**
 * Renders the series-page control for caching unread downloaded issues.
 *
 * The visible counter reflects all browser-cached downloaded issues, while the
 * action only downloads unread issues that are missing from the cache.
 */
export function BulkDownload({ issues, downloadedIssues }: BulkDownloadProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
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

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const missingIssues = useMemo(
    () => issues.filter((issue) => !cachedIds.has(issue.issueId)),
    [cachedIds, issues],
  );
  const cachedCount = downloadedIssues.filter((issue) => cachedIds.has(issue.issueId)).length;
  const isBusy = phase === "checking" || phase === "downloading";
  const runProgress = totalThisRun > 0
    ? Math.round(((completedThisRun + activeProgress) / totalThisRun) * 100)
    : 0;
  const clampedRunProgress = Math.min(100, Math.max(0, runProgress));
  const actionCopy = getDownloadActionCopy({
    phase,
    unreadIssueCount: issues.length,
    missingIssueCount: missingIssues.length,
    completedCount: completedThisRun,
    totalCount: totalThisRun,
  });

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
    <div ref={containerRef} class="relative z-20 shrink-0 pt-1">
      <button
        ref={buttonRef}
        type="button"
        class="inline-flex h-12 w-12 items-center justify-center text-slate-400 transition-colors hover:text-amber-500 focus-visible:text-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="series-download-options"
        aria-label="Download options"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Icon name="more-vertical" class="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          id="series-download-options"
          role="dialog"
          aria-label="Download options"
          class="absolute right-0 top-full z-30 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col border-t-2 border-amber-500 bg-slate-900 shadow-xl shadow-black/40"
        >
          <div class="flex flex-col gap-2 border-b border-slate-800 p-4">
            <span class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Cache
            </span>
            <div
              role="group"
              aria-label={`${cachedCount} of ${downloadedIssues.length} downloaded`}
              class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500"
            >
              {phase === "checking" ? (
                <span>Checking cache</span>
              ) : (
                <>
                  <span>Cached</span>
                  <span class="text-amber-500">{cachedCount}</span>
                  <span>/</span>
                  <span>{downloadedIssues.length}</span>
                  <span>downloaded</span>
                </>
              )}
            </div>
          </div>

          <div class="flex flex-col p-2">
            <button
              type="button"
              class="flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:bg-slate-800 hover:text-amber-500 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent disabled:hover:text-slate-600"
              disabled={isBusy || missingIssues.length === 0}
              onClick={() => void downloadIssues(missingIssues)}
            >
              <Icon name="sync" class="h-4 w-4 shrink-0" />
              <span class="flex flex-col gap-1">
                <span>{actionCopy.label}</span>
                <span class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                  {actionCopy.detail}
                </span>
              </span>
            </button>

            {failedIssues.length > 0 && phase !== "downloading" && (
              <button
                type="button"
                class="flex min-h-12 w-full items-center gap-3 border-t border-slate-800 px-3 py-3 text-left text-xs font-bold uppercase tracking-widest text-red-300 transition-colors hover:bg-red-950 hover:text-red-200"
                onClick={() => void downloadIssues(failedIssues)}
              >
                Retry {failedIssues.length} issue{failedIssues.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {phase === "downloading" && (
            <div role="status" aria-live="polite" class="flex flex-col gap-2 border-t border-slate-800 p-4">
              <div class="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span class="truncate font-semibold text-slate-300">
                  {activeIssue ? formatIssueLabel(activeIssue) : "Caching comics"}
                </span>
                <span class="font-semibold tabular-nums text-amber-500">
                  {clampedRunProgress}%
                </span>
              </div>
              <div
                class="h-1 overflow-hidden bg-slate-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampedRunProgress}
                aria-label="Bulk cache progress"
              >
                <div
                  class="h-full bg-amber-500 transition-[width] duration-200"
                  style={{ width: `${clampedRunProgress}%` }}
                />
              </div>
            </div>
          )}

          {failedIssues.length > 0 && phase !== "downloading" && (
            <p role="alert" class="border-t border-slate-800 p-4 text-xs font-semibold text-red-400">
              Failed to cache {failedIssues.length} issue{failedIssues.length === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
