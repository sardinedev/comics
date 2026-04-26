import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@components/Icon/Icon";
import { downloadCbz, extractPages } from "./comicReader.utils";

type ComicReaderProps = {
  issueId: string;
  initialPage: number;
  seriesName: string;
  issueNumber: number;
};

export function ComicReader({
  issueId,
  initialPage,
  seriesName,
  issueNumber,
}: ComicReaderProps) {
  const currentPage = useSignal(0);
  const downloadProgress = useSignal(0);
  const error = useSignal<string | null>(null);
  const isFullscreen = useSignal(false);
  const isLoading = useSignal(true);
  const pages = useSignal<string[]>([]);
  const phase = useSignal<"downloading" | "extracting" | "ready">("downloading");
  const showHomeScreenHint = useSignal(false);
  const showUI = useSignal(true);
  const supportsFullscreen = useSignal(false);

  const pageLabel = useComputed(
    () => `${currentPage.value + 1} / ${pages.value.length}`,
  );

  // Tracks the last saved page number so the periodic save can skip when nothing changed.
  const lastSavedPageRef = useRef<number | null>(null);

  function buildProgressBody(): string {
    return JSON.stringify({
      current_page: currentPage.value + 1,
      total_pages: pages.value.length,
    });
  }

  /**
   * Sends progress via `sendBeacon`. Used on `visibilitychange`,
   * `beforeunload`, periodic interval, and explicit navigation — all of which
   * tolerate (or require) fire-and-forget delivery.
   */
  function flushProgress() {
    if (pages.value.length === 0) return;
    if (lastSavedPageRef.current === currentPage.value) return;
    const ok = navigator.sendBeacon(
      `/api/comic/${issueId}/progress`,
      new Blob([buildProgressBody()], { type: "application/json" }),
    );
    if (ok) lastSavedPageRef.current = currentPage.value;
  }

  useEffect(() => {
    supportsFullscreen.value = "requestFullscreen" in document.documentElement;
    lastSavedPageRef.current = null;

    let cancelled = false;
    let createdUrls: string[] = [];

    (async () => {
      try {
        const cbz = await downloadCbz(issueId, (ratio) => {
          downloadProgress.value = ratio;
        });
        if (cancelled) return;

        phase.value = "extracting";
        const urls = await extractPages(cbz);
        if (cancelled) {
          // Effect was torn down while extracting — revoke the URLs we just created
          for (const url of urls) URL.revokeObjectURL(url);
          return;
        }

        createdUrls = urls;
        pages.value = urls;
        // Clamp initialPage: it's 1-indexed from ES, convert to 0-indexed
        const startPage = Math.max(0, Math.min((initialPage || 1) - 1, urls.length - 1));
        currentPage.value = startPage;
        phase.value = "ready";
        isLoading.value = false;
        showUI.value = false;
      } catch (err) {
        if (cancelled) return;
        error.value = err instanceof Error ? err.message : "Failed to load comic";
        isLoading.value = false;
      }
    })();

    return () => {
      cancelled = true;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [issueId]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        navigateBack();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sync fullscreen signal with browser state
  useEffect(() => {
    const handler = () => {
      isFullscreen.value = !!document.fullscreenElement;
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Save progress on tab hide, navigation away, and periodically as a safety net.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    const onBeforeUnload = () => flushProgress();
    const interval = setInterval(flushProgress, 30_000);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(interval);
    };
  }, [issueId]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Failed to enter fullscreen", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Failed to exit fullscreen", err);
      });
    }
  }

  function goNext() {
    if (currentPage.value < pages.value.length - 1) {
      currentPage.value++;
    }
  }

  function goPrev() {
    if (currentPage.value > 0) {
      currentPage.value--;
    }
  }

  function navigateBack() {
    flushProgress();
    window.location.href = `/comic/${issueId}`;
  }

  function handleTap(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    if (x < 0.33) {
      goPrev();
    } else if (x > 0.66) {
      goNext();
    } else {
      showUI.value = !showUI.value;
    }
  }

  // Loading state
  if (isLoading.value) {
    return (
      <div
        class="flex h-dvh w-dvw flex-col items-center justify-center gap-6"
        role="status"
        aria-live="polite"
      >
        <p class="text-sm font-bold uppercase tracking-widest text-slate-400">
          {phase.value === "downloading" ? "Downloading…" : "Extracting pages…"}
        </p>
        <div
          class="h-1 w-64 overflow-hidden bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(downloadProgress.value * 100)}
          aria-label={phase.value === "downloading" ? "Download progress" : "Extraction progress"}
        >
          <div
            class="h-full bg-amber-500 transition-[width] duration-200"
            style={{ width: `${Math.round(downloadProgress.value * 100)}%` }}
          />
        </div>
        <p class="text-xs tabular-nums text-slate-600">
          {Math.round(downloadProgress.value * 100)}%
        </p>
      </div>
    );
  }

  // Error state
  if (error.value) {
    return (
      <div
        class="flex h-dvh w-dvw flex-col items-center justify-center gap-4"
        role="alert"
      >
        <p class="text-sm text-red-400">{error.value}</p>
        <a
          href={`/comic/${issueId}`}
          class="text-sm font-semibold text-amber-500 hover:underline"
        >
          Back to issue
        </a>
      </div>
    );
  }

  // Reader
  const nextPageUrl = pages.value[currentPage.value + 1];

  return (
    <div class="relative h-dvh w-dvw select-none">
      {/* Page image */}
      <div
        class="flex h-full w-full cursor-pointer items-center justify-center"
        onClick={handleTap}
      >
        <img
          src={pages.value[currentPage.value]}
          alt={`Page ${currentPage.value + 1}`}
          class="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>

      {/* Preload next page off-screen — more reliable than dynamic <link rel="preload"> */}
      {nextPageUrl && (
        <img
          src={nextPageUrl}
          alt=""
          aria-hidden="true"
          class="pointer-events-none absolute h-0 w-0 opacity-0"
          loading="eager"
          decoding="async"
        />
      )}

      {/* HUD overlay */}
      {showUI.value && (
        <>
          {/* Top bar */}
          <div class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 to-transparent pb-12 pt-4">
            <div class="pointer-events-auto flex items-center gap-4 px-4">
              <button
                onClick={navigateBack}
                class="flex h-10 w-10 items-center justify-center text-white/80 hover:text-white"
                aria-label="Back to issue"
              >
                <Icon name="chevron-left" />
              </button>
              <p class="truncate text-sm font-semibold text-white/90">
                {seriesName}{" "}
                <span class="text-amber-500">#{issueNumber}</span>
              </p>
              <button
                onClick={
                  supportsFullscreen.value
                    ? toggleFullscreen
                    : () => {
                        showHomeScreenHint.value = !showHomeScreenHint.value;
                      }
                }
                class="ml-auto flex h-10 w-10 items-center justify-center text-white/80 hover:text-white [@media(display-mode:standalone)]:hidden"
                aria-label={isFullscreen.value ? "Exit fullscreen" : "Enter fullscreen"}
              >
                <Icon name={isFullscreen.value ? "fullscreen-exit" : "fullscreen"} />
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent pb-4 pt-12">
            <p
              class="text-center text-sm font-semibold tabular-nums text-white/80"
              aria-live="polite"
              aria-atomic="true"
            >
              {pageLabel}
            </p>
          </div>
        </>
      )}
      {/* Add to Home Screen hint */}
      {showHomeScreenHint.value && (
        <div class="pointer-events-auto absolute inset-x-4 bottom-16 z-30 rounded-xl bg-slate-900/95 p-4 shadow-xl">
          <p class="mb-1 text-sm font-semibold text-white">Fullscreen on iOS</p>
          <p class="text-sm text-slate-400">
            Tap <span class="font-medium text-white">Share</span> → <span class="font-medium text-white">Add to Home Screen</span> to read without browser chrome.
          </p>
          <button
            onClick={() => { showHomeScreenHint.value = false; }}
            class="mt-3 text-xs font-semibold text-amber-500"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
