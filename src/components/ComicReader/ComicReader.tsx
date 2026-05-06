import { useComputed, useSignal } from "@preact/signals";
import type { TargetedMouseEvent, TargetedPointerEvent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@components/Icon/Icon";
import { downloadCbz, extractPages } from "./comicReader.utils";
import {
  DOUBLE_TAP_MAX_DELAY_MS,
  classifySwipe,
  clampZoomTranslation,
  getHalfPageZoomTarget,
  getHorizontalPanEdge,
  getPointZoomRegion,
  getTapZone,
  getZoomBounds,
  isDoublePageSpread,
  isDoubleTap,
  isTapGesture,
} from "./comicReader.gestures";
import type {
  ActiveGesture,
  ComicReaderProps,
  GesturePoint,
  ImageMetrics,
  ReaderZoomState,
} from "./comicReader.types";

function defaultZoomState(): ReaderZoomState {
  return { region: null, scale: 1, translateX: 0, translateY: 0 };
}

export function ComicReader({
  issueId,
  initialPage,
  nextIssue,
}: ComicReaderProps) {
  const currentPage = useSignal(0);
  const downloadProgress = useSignal(0);
  const error = useSignal<string | null>(null);
  const imageMetrics = useSignal<ImageMetrics | null>(null);
  const isFullscreen = useSignal(false);
  const isPanning = useSignal(false);
  const isLoading = useSignal(true);
  const pages = useSignal<string[]>([]);
  const phase = useSignal<"downloading" | "extracting" | "ready">("downloading");
  const showHomeScreenHint = useSignal(false);
  const showUI = useSignal(true);
  const supportsFullscreen = useSignal(false);
  const zoom = useSignal<ReaderZoomState>(defaultZoomState());

  const pageLabel = useComputed(
    () => `${currentPage.value + 1} / ${pages.value.length}`,
  );
  const isLastPage = useComputed(
    () => pages.value.length > 0 && currentPage.value === pages.value.length - 1,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const interactionLayerRef = useRef<HTMLDivElement>(null);

  // Tracks the last saved page number so the periodic save can skip when nothing changed.
  const lastSavedPageRef = useRef<number | null>(null);
  const activeGestureRef = useRef<ActiveGesture | null>(null);
  const lastTapRef = useRef<GesturePoint | null>(null);
  const pendingTapTimeoutRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<number | null>(null);

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

  function clearPendingTap() {
    if (pendingTapTimeoutRef.current !== null) {
      window.clearTimeout(pendingTapTimeoutRef.current);
      pendingTapTimeoutRef.current = null;
    }
    lastTapRef.current = null;
  }

  function resetZoom() {
    zoom.value = defaultZoomState();
    isPanning.value = false;
  }

  function measureImage() {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

    const rect = container.getBoundingClientRect();
    const metrics: ImageMetrics = {
      container: {
        width: rect.width || container.clientWidth || window.innerWidth,
        height: rect.height || container.clientHeight || window.innerHeight,
      },
      natural: {
        width: image.naturalWidth,
        height: image.naturalHeight,
      },
    };

    imageMetrics.value = metrics;

    if (!zoom.value.region) return;
    if (!isDoublePageSpread(metrics.natural)) {
      resetZoom();
      return;
    }

    zoom.value = getHalfPageZoomTarget(metrics, zoom.value.region);
  }

  function getPointerPoint(event: TargetedPointerEvent<HTMLDivElement>): GesturePoint {
    return { x: event.clientX, y: event.clientY, time: event.timeStamp };
  }

  function suppressNextClick() {
    suppressClickRef.current = true;
    if (suppressClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressClickTimeoutRef.current);
    }
    suppressClickTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimeoutRef.current = null;
    }, 700);
  }

  function ignoreSuppressedClick(event: TargetedMouseEvent<HTMLButtonElement>): boolean {
    if (!suppressClickRef.current) return false;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
    return true;
  }

  function getTapX(point: GesturePoint): { x: number; width: number } | null {
    const layer = interactionLayerRef.current;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    return {
      x: point.x - rect.left,
      width: rect.width || window.innerWidth,
    };
  }

  function handleSingleTap(point: GesturePoint) {
    const tap = getTapX(point);
    if (!tap) return;
    const zone = getTapZone(tap.x, tap.width);

    if (zoom.value.region) {
      if (zone === "controls") toggleUI();
      return;
    }

    if (zone === "previous") goPrev();
    else if (zone === "next") goNext();
    else toggleUI();
  }

  function handleDoubleTap(point: GesturePoint) {
    const tap = getTapX(point);
    const metrics = imageMetrics.value;
    if (!tap || !metrics) return;

    if (!isDoublePageSpread(metrics.natural)) {
      if (zoom.value.region) resetZoom();
      return;
    }

    const region = getPointZoomRegion(tap.x, tap.width);
    if (zoom.value.region === region) {
      resetZoom();
      return;
    }

    zoom.value = getHalfPageZoomTarget(metrics, region);
    showUI.value = false;
  }

  function handleTap(point: GesturePoint) {
    if (isDoubleTap(lastTapRef.current, point)) {
      clearPendingTap();
      handleDoubleTap(point);
      return;
    }

    lastTapRef.current = point;
    if (pendingTapTimeoutRef.current !== null) {
      window.clearTimeout(pendingTapTimeoutRef.current);
    }

    pendingTapTimeoutRef.current = window.setTimeout(() => {
      pendingTapTimeoutRef.current = null;
      lastTapRef.current = null;
      handleSingleTap(point);
    }, DOUBLE_TAP_MAX_DELAY_MS);
  }

  function goToPage(pageIndex: number) {
    if (pages.value.length === 0) return;
    const nextPage = Math.max(0, Math.min(pageIndex, pages.value.length - 1));
    if (nextPage === currentPage.value) return;
    clearPendingTap();
    currentPage.value = nextPage;
    resetZoom();
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
  }, [issueId, initialPage]);

  useEffect(() => {
    const onResize = () => measureImage();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    return () => {
      clearPendingTap();
      if (suppressClickTimeoutRef.current !== null) {
        window.clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, []);

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
        if (document.fullscreenElement) {
          e.preventDefault();
          void document.exitFullscreen();
        } else {
          navigateBack();
        }
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
    goToPage(currentPage.value + 1);
  }

  function goPrev() {
    goToPage(currentPage.value - 1);
  }

  function navigateBack() {
    flushProgress();
    window.location.href = `/comic/${issueId}`;
  }

  function toggleUI() {
    showUI.value = !showUI.value;
  }

  function handlePointerDown(event: TargetedPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || !event.isPrimary) return;

    suppressNextClick();
    const point = getPointerPoint(event);
    const bounds = zoom.value.region && imageMetrics.value
      ? getZoomBounds(imageMetrics.value, zoom.value.scale)
      : null;

    activeGestureRef.current = {
      pointerId: event.pointerId,
      start: point,
      zoomStart: zoom.value,
      edgeAtStart: bounds ? getHorizontalPanEdge(zoom.value.translateX, bounds) : null,
    };
    isPanning.value = !!zoom.value.region;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser-test events may not create a capturable pointer.
    }
  }

  function handlePointerMove(event: TargetedPointerEvent<HTMLDivElement>) {
    const active = activeGestureRef.current;
    const metrics = imageMetrics.value;
    if (!active || active.pointerId !== event.pointerId || !active.zoomStart.region || !metrics) return;

    const point = getPointerPoint(event);
    const bounds = getZoomBounds(metrics, active.zoomStart.scale);
    const translation = clampZoomTranslation(
      active.zoomStart.translateX + point.x - active.start.x,
      active.zoomStart.translateY + point.y - active.start.y,
      bounds,
    );

    zoom.value = {
      ...zoom.value,
      translateX: translation.translateX,
      translateY: translation.translateY,
    };
    event.preventDefault();
  }

  function finishPointerGesture(event: TargetedPointerEvent<HTMLDivElement>) {
    const active = activeGestureRef.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const end = getPointerPoint(event);
    const swipe = classifySwipe(active.start, end);
    const wasZoomed = !!active.zoomStart.region;
    activeGestureRef.current = null;
    isPanning.value = false;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Synthetic browser-test events may not hold pointer capture.
    }

    if (wasZoomed) {
      if (swipe === "previous" && active.edgeAtStart === "left") goPrev();
      else if (swipe === "next" && active.edgeAtStart === "right") goNext();
      else if (isTapGesture(active.start, end)) handleTap(end);
      return;
    }

    if (swipe === "previous") goPrev();
    else if (swipe === "next") goNext();
    else if (isTapGesture(active.start, end)) handleTap(end);
  }

  function cancelPointerGesture(event: TargetedPointerEvent<HTMLDivElement>) {
    if (activeGestureRef.current?.pointerId !== event.pointerId) return;
    activeGestureRef.current = null;
    isPanning.value = false;
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
  const imageTransform = zoom.value.region
    ? `translate3d(${zoom.value.translateX}px, ${zoom.value.translateY}px, 0) scale(${zoom.value.scale})`
    : undefined;
  const nextIssueReadUrl = nextIssue ? `/comic/${nextIssue.id}/read` : null;

  return (
    <div class="relative h-dvh w-dvw select-none">
      {/* Page image */}
      <div ref={containerRef} class="flex h-full w-full items-center justify-center overflow-hidden">
        <img
          ref={imageRef}
          src={pages.value[currentPage.value]}
          alt={`Page ${currentPage.value + 1}`}
          class="max-h-full max-w-full object-contain will-change-transform"
          draggable={false}
          data-zoom-region={zoom.value.region ?? undefined}
          onLoad={measureImage}
          style={{
            transform: imageTransform,
            transformOrigin: "center center",
            transition: isPanning.value ? "none" : "transform 150ms ease-in-out",
          }}
        />
      </div>

      {/* Tap zones — sit above the image but below the HUD */}
      <div
        ref={interactionLayerRef}
        class="absolute inset-0 z-10 flex touch-none"
        data-reader-gesture-layer="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={cancelPointerGesture}
      >
        <button
          type="button"
          onClick={(event) => {
            if (ignoreSuppressedClick(event)) return;
            goPrev();
          }}
          class="group flex h-full w-1/3 cursor-pointer items-center justify-start pl-4"
          aria-label="Previous page"
        >
          {/* Visible only on devices that support hover (i.e. desktop) */}
          <span class="hidden opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:hover)]:inline-flex">
            <Icon name="chevron-left" class="h-10 w-10 text-white/80" />
          </span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            if (ignoreSuppressedClick(event)) return;
            toggleUI();
          }}
          class="h-full w-1/3 cursor-pointer"
          aria-label="Toggle controls"
        />
        <button
          type="button"
          onClick={(event) => {
            if (ignoreSuppressedClick(event)) return;
            goNext();
          }}
          class="group flex h-full w-1/3 cursor-pointer items-center justify-end pr-4"
          aria-label="Next page"
        >
          <span class="hidden opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:hover)]:inline-flex">
            <Icon name="chevron-right" class="h-10 w-10 text-white/80" />
          </span>
        </button>
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
                onClick={
                  supportsFullscreen.value
                    ? toggleFullscreen
                    : () => {
                        showHomeScreenHint.value = !showHomeScreenHint.value;
                      }
                }
                class="flex h-10 w-10 items-center justify-center text-white/80 hover:text-white [@media(display-mode:standalone)]:hidden"
                aria-label={isFullscreen.value ? "Exit fullscreen" : "Enter fullscreen"}
              >
                <Icon name={isFullscreen.value ? "fullscreen-exit" : "fullscreen"} />
              </button>
              <button
                onClick={navigateBack}
                class="ml-auto flex h-10 w-10 items-center justify-center text-white/80 hover:text-white"
                aria-label="Close reader"
              >
                <Icon name="close" />
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
      {nextIssue && nextIssueReadUrl && isLastPage.value && (
        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 pb-5 pt-16">
          <div class="pointer-events-auto mx-auto flex max-w-xl items-center justify-between gap-4 border-t border-slate-700 bg-black/80 px-4 py-3 backdrop-blur-sm">
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500">Next issue?</p>
              <p class="truncate text-sm font-semibold text-white">
                {nextIssue.seriesName} #{nextIssue.issueNumber}
              </p>
              {nextIssue.issueName && (
                <p class="truncate text-xs text-slate-400">{nextIssue.issueName}</p>
              )}
            </div>
            <a
              href={nextIssueReadUrl}
              onClick={() => flushProgress()}
              class="shrink-0 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400"
            >
              Read next
            </a>
          </div>
        </div>
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
