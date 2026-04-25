import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Unzip, UnzipInflate } from "fflate";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

type ComicReaderProps = {
  issueId: string;
  initialPage: number;
  seriesName: string;
  issueNumber: number;
};

function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches !== "undefined") return await caches.open("comic-reader-v1");
  } catch { /* Cache API unavailable (HTTP, older browser, etc.) */ }
  return null;
}

async function downloadCbz(
  issueId: string,
  onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
  const url = `/api/comic/${issueId}/download`;
  const cache = await openCache();

  // Check cache first
  if (cache) {
    const cached = await cache.match(url);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      onProgress(1);
      return new Uint8Array(buffer);
    }
  }

  // Fetch with progress tracking
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Download failed (${res.status})`);
  }

  const contentLength = Number(res.headers.get("Content-Length") ?? 0);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress(received / contentLength);
    }
  }

  // Combine chunks
  const cbz = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    cbz.set(chunk, offset);
    offset += chunk.length;
  }

  // Store in cache for offline reading (when available)
  if (cache) {
    await cache.put(
      url,
      new Response(cbz.buffer, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  }

  return cbz;
}

function extractPages(cbz: Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const fileMap = new Map<string, Uint8Array[]>();
    const unzip = new Unzip();
    unzip.register(UnzipInflate);

    unzip.onfile = (file) => {
      // Skip macOS metadata and non-image files
      if (file.name.startsWith("__MACOSX/") || !isImageFile(file.name)) {
        file.ondata = () => {};
        return;
      }

      const fileChunks: Uint8Array[] = [];
      fileMap.set(file.name, fileChunks);

      file.ondata = (_err, data, final) => {
        if (_err) return;
        fileChunks.push(data);
        if (final) {
          // nothing else to do — we sort and create URLs after all files are processed
        }
      };

      file.start();
    };

    // Feed data in chunks to allow streaming
    const chunkSize = 65536;
    for (let i = 0; i < cbz.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, cbz.length);
      const isLast = end === cbz.length;
      unzip.push(cbz.slice(i, end), isLast);
    }

    // After push with final=true, all file callbacks should have fired
    // Sort filenames alphabetically (same order as covers.ts)
    const sortedNames = [...fileMap.keys()].sort((a, b) =>
      a.localeCompare(b),
    );

    const urls: string[] = [];
    for (const name of sortedNames) {
      const chunks = fileMap.get(name)!;
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let pos = 0;
      for (const chunk of chunks) {
        combined.set(chunk, pos);
        pos += chunk.length;
      }
      const blob = new Blob([combined], { type: getMimeType(name) });
      urls.push(URL.createObjectURL(blob));
    }

    if (urls.length === 0) {
      reject(new Error("No pages found in archive"));
    } else {
      resolve(urls);
    }
  });
}

export function ComicReader({
  issueId,
  initialPage,
  seriesName,
  issueNumber,
}: ComicReaderProps) {
  const pages = useSignal<string[]>([]);
  const currentPage = useSignal(0);
  const downloadProgress = useSignal(0);
  const isLoading = useSignal(true);
  const showUI = useSignal(true);
  const isFullscreen = useSignal(false);
  const supportsFullscreen = useSignal(false);
  const showHomeScreenHint = useSignal(false);
  const error = useSignal<string | null>(null);
  const phase = useSignal<"downloading" | "extracting" | "ready">("downloading");

  const pageLabel = useComputed(
    () => `${currentPage.value + 1} / ${pages.value.length}`,
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagesRef = useRef<string[]>([]);

  useEffect(() => {
    supportsFullscreen.value = "requestFullscreen" in document.documentElement;

    let cancelled = false;

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

        pagesRef.current = urls;
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
      // Revoke all object URLs
      for (const url of pagesRef.current) {
        URL.revokeObjectURL(url);
      }
      pagesRef.current = [];
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

  // Save progress on beforeunload
  useEffect(() => {
    const onBeforeUnload = () => {
      if (pages.value.length === 0) return;
      const body = JSON.stringify({
        current_page: currentPage.value + 1,
        total_pages: pages.value.length,
      });
      navigator.sendBeacon(
        `/api/comic/${issueId}/progress`,
        new Blob([body], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [issueId]);

  function saveProgress() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/comic/${issueId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_page: currentPage.value + 1,
          total_pages: pages.value.length,
        }),
      });
    }, 1000);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function goNext() {
    if (currentPage.value < pages.value.length - 1) {
      currentPage.value++;
      saveProgress();
    }
  }

  function goPrev() {
    if (currentPage.value > 0) {
      currentPage.value--;
      saveProgress();
    }
  }

  function navigateBack() {
    // Flush any pending save immediately
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (pages.value.length > 0) {
      navigator.sendBeacon(
        `/api/comic/${issueId}/progress`,
        new Blob(
          [JSON.stringify({
            current_page: currentPage.value + 1,
            total_pages: pages.value.length,
          })],
          { type: "application/json" },
        ),
      );
    }
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
      <div class="flex h-dvh w-dvw flex-col items-center justify-center gap-6">
        <p class="text-sm font-bold uppercase tracking-widest text-slate-400">
          {phase.value === "downloading" ? "Downloading…" : "Extracting pages…"}
        </p>
        <div class="h-1 w-64 overflow-hidden bg-slate-800">
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
      <div class="flex h-dvh w-dvw flex-col items-center justify-center gap-4">
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

      {/* Preload next page */}
      {nextPageUrl && (
        <link rel="preload" as="image" href={nextPageUrl} />
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <p class="truncate text-sm font-semibold text-white/90">
                {seriesName}{" "}
                <span class="text-amber-500">#{issueNumber}</span>
              </p>
              <button
                  onClick={supportsFullscreen.value ? toggleFullscreen : () => { showHomeScreenHint.value = !showHomeScreenHint.value; }}
                  class="[@media(display-mode:standalone)]:hidden ml-auto flex h-10 w-10 items-center justify-center text-white/80 hover:text-white"
                  aria-label={isFullscreen.value ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  <div
                    style={{
                      mask: `url(/icons/${isFullscreen.value ? "fullscreen-exit" : "fullscreen"}.svg) no-repeat center`,
                      maskSize: "contain",
                      backgroundColor: "currentColor",
                    }}
                    class="h-6 w-6"
                  />
                </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent pb-4 pt-12">
            <p class="text-center text-sm font-semibold tabular-nums text-white/80">
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
