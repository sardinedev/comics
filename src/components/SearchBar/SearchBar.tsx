import { signal, computed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

type SearchResult = {
  series_id: string;
  series_name: string;
  series_year: string;
  series_publisher?: string;
  series_cover_url?: string;
};

const query = signal("");
const results = signal<SearchResult[]>([]);
const loading = signal(false);
const activeIndex = signal(-1);
const hasResults = computed(() => results.value.length > 0);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onQueryInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  query.value = val;
  activeIndex.value = -1;

  if (debounceTimer) clearTimeout(debounceTimer);

  if (!val.trim()) {
    results.value = [];
    loading.value = false;
    return;
  }

  loading.value = true;
  debounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`);
      if (res.ok) results.value = await res.json();
    } finally {
      loading.value = false;
    }
  }, 250);
}

function onKeyDown(e: KeyboardEvent) {
  const len = results.value.length;
  if (!len) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, len - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (e.key === "Enter" && activeIndex.value >= 0) {
    e.preventDefault();
    const hit = results.value[activeIndex.value];
    if (hit) window.location.href = `/series/${hit.series_id}`;
  }
}

export function SearchBar() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expose open method for the header button
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    function openDialog() {
      query.value = "";
      results.value = [];
      loading.value = false;
      activeIndex.value = -1;
      el!.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }

    window.addEventListener("open-search", openDialog);
    return () => window.removeEventListener("open-search", openDialog);
  }, []);

  function onDialogClick(e: MouseEvent) {
    // Close when clicking the backdrop (dialog itself, not its children)
    if (e.target === dialogRef.current) dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      data-scroll="Dialog"
      class="m-0 w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      style="top: 0; left: 0; height: 100dvh; max-height: 100dvh;"
      aria-label="Search series"
    >
      {/*
        Mobile: flush to top, full-width, no side borders.
        Desktop (sm+): centered card with top margin and border.
      */}
      <div class="w-full border-b border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 sm:mx-auto sm:mt-16 sm:max-w-xl sm:border">

        {/* Input row */}
        <div class="flex items-center border-b border-slate-800">
          <span
            aria-hidden="true"
            class="ml-4 mr-3 flex-shrink-0"
            style={{
              mask: "url(/icons/search.svg) no-repeat center",
              maskSize: "contain",
              backgroundColor: loading.value ? "#f59e0b" : "#475569",
              width: "16px",
              height: "16px",
              transition: "background-color 150ms",
            }}
          />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            spellcheck={false}
            placeholder="Search series…"
            aria-label="Search series"
            aria-autocomplete="list"
            aria-controls="search-listbox"
            role="combobox"
            aria-expanded={hasResults.value}
            value={query.value}
            onInput={onQueryInput}
            onKeyDown={onKeyDown}
            class="h-14 flex-1 bg-transparent text-base text-white placeholder-slate-500 outline-none sm:text-sm"
          />
          {/* Desktop: Esc hint. Mobile: Cancel button. */}
          <kbd class="mr-4 hidden flex-shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 sm:block">
            Esc
          </kbd>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            class="mr-4 flex-shrink-0 text-xs font-bold uppercase tracking-widest text-slate-400 sm:hidden"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        {hasResults.value && (
          <ul id="search-listbox" role="listbox" aria-label="Search results">
            {results.value.map((r, i) => {
              const active = activeIndex.value === i;
              return (
                <li key={r.series_id} role="option" aria-selected={active}>
                  <a
                    href={`/series/${r.series_id}`}
                    class={`flex items-center gap-3 px-4 py-3 transition-colors sm:py-2.5 ${active ? "bg-slate-800" : "hover:bg-slate-800/60"}`}
                    onMouseEnter={() => { activeIndex.value = i; }}
                  >
                    {/* Thumbnail */}
                    <div class="h-12 w-8 flex-shrink-0 overflow-hidden bg-slate-800 ring-1 ring-white/5 sm:h-11">
                      {r.series_cover_url ? (
                        <img src={r.series_cover_url} alt="" class="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div
                          class="h-full w-full"
                          style={{
                            mask: "url(/icons/image-placeholder.svg) no-repeat center",
                            maskSize: "40%",
                            backgroundColor: "#334155",
                          }}
                        />
                      )}
                    </div>

                    {/* Text */}
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-bold leading-tight text-white">{r.series_name}</p>
                      <p class="truncate text-xs text-slate-500">
                        {[r.series_year, r.series_publisher].filter(Boolean).join(" · ")}
                      </p>
                    </div>

                    {/* Arrow — desktop hover indicator */}
                    <div
                      aria-hidden="true"
                      class={`hidden flex-shrink-0 transition-opacity sm:block ${active ? "opacity-100" : "opacity-0"}`}
                      style={{
                        mask: "url(/icons/arrow-forward.svg) no-repeat center",
                        maskSize: "contain",
                        backgroundColor: "#f59e0b",
                        width: "14px",
                        height: "14px",
                      }}
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {/* Empty state */}
        {query.value.trim() && !loading.value && !hasResults.value && (
          <p class="px-4 py-4 text-xs text-slate-500">
            No results for <span class="text-slate-300">"{query.value}"</span>
          </p>
        )}
      </div>
    </dialog>
  );
}
