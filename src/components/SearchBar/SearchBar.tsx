import { signal, computed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SEARCH_RESULT_LIMIT } from "@data/search.constants";

type LibraryResult = {
  series_id: string;
  series_name: string;
  series_year: string;
  series_publisher?: string;
  series_cover_url?: string;
};

type CVResult = {
  id: number;
  name: string;
  start_year: string;
  publisher?: string;
  cover_url?: string;
};

const query = signal("");
const libraryResults = signal<LibraryResult[]>([]);
const cvResults = signal<CVResult[]>([]);
const loadingLibrary = signal(false);
const loadingCV = signal(false);
const loading = computed(() => loadingLibrary.value || loadingCV.value);
const hasAnyResults = computed(() => libraryResults.value.length > 0 || cvResults.value.length > 0);

// Flat list of visible results for keyboard navigation: library first, then CV.
// activeIndex indexes into this list; cvOffset is where CV results start.
const allResults = computed(() => [
  ...libraryResults.value.slice(0, 5).map((r) => ({ type: "library" as const, ...r })),
  ...cvResults.value.slice(0, 5).map((r) => ({ type: "cv" as const, ...r })),
]);
const cvOffset = computed(() => libraryResults.value.slice(0, 5).length);
const activeIndex = signal(-1);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onQueryInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  query.value = val;
  activeIndex.value = -1;

  if (debounceTimer) clearTimeout(debounceTimer);

  if (!val.trim()) {
    libraryResults.value = [];
    cvResults.value = [];
    loadingLibrary.value = false;
    loadingCV.value = false;
    return;
  }

  loadingLibrary.value = true;
  loadingCV.value = true;

  debounceTimer = setTimeout(() => {
    const q = encodeURIComponent(val.trim());

    fetch(`/api/search?q=${q}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { libraryResults.value = data; })
      .finally(() => { loadingLibrary.value = false; });

    fetch(`/api/search/comicvine?q=${q}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { cvResults.value = data; })
      .finally(() => { loadingCV.value = false; });
  }, 250);
}

function onKeyDown(e: KeyboardEvent) {
  const len = allResults.value.length;
  if (!len) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, len - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (e.key === "Enter" && activeIndex.value >= 0) {
    e.preventDefault();
    const hit = allResults.value[activeIndex.value];
    if (hit?.type === "library") window.location.href = `/series/${hit.series_id}`;
    if (hit?.type === "cv") window.location.href = `/series/comicvine/${hit.id}`;
  }
}

function ResultItem({
  cover, name, meta, href, active, onHover,
}: {
  cover?: string; name: string; meta: string; href: string;
  active: boolean; onHover: () => void;
}) {
  return (
    <a
      href={href}
      class={`flex items-center gap-3 px-4 py-3 transition-colors sm:py-2.5 ${active ? "bg-slate-800" : "hover:bg-slate-800/60"}`}
      onMouseEnter={onHover}
    >
      <div class="h-12 w-8 flex-shrink-0 overflow-hidden bg-slate-800 ring-1 ring-white/5 sm:h-11">
        {cover ? (
          <img src={cover} alt="" class="h-full w-full object-cover" loading="lazy" />
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
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-bold leading-tight text-white">{name}</p>
        <p class="truncate text-xs text-slate-500">{meta}</p>
      </div>
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
  );
}

function SectionLabel({ children, loading }: { children: string; loading: boolean }) {
  return (
    <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-slate-600">{children}</span>
      {loading && (
        <span
          aria-hidden="true"
          class="flex-shrink-0"
          style={{
            mask: "url(/icons/sync.svg) no-repeat center",
            maskSize: "contain",
            backgroundColor: "#475569",
            width: "10px",
            height: "10px",
          }}
        />
      )}
    </div>
  );
}

export function SearchBar() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    function openDialog() {
      query.value = "";
      libraryResults.value = [];
      cvResults.value = [];
      loadingLibrary.value = false;
      loadingCV.value = false;
      activeIndex.value = -1;
      el!.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }

    // "open-search" is dispatched by the search button in Header.astro.
    window.addEventListener("open-search", openDialog);
    return () => window.removeEventListener("open-search", openDialog);
  }, []);

  function onDialogClick(e: MouseEvent) {
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
            aria-expanded={hasAnyResults.value}
            value={query.value}
            onInput={onQueryInput}
            onKeyDown={onKeyDown}
            class="h-14 flex-1 bg-transparent text-base text-white placeholder-slate-500 outline-none sm:text-sm"
          />
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
        {hasAnyResults.value && (
          <ul id="search-listbox" role="listbox" aria-label="Search results">

            {/* Library section */}
            {libraryResults.value.length > 0 && (
              <>
                <li role="presentation">
                  <SectionLabel loading={loadingLibrary.value}>In your library</SectionLabel>
                </li>
                {libraryResults.value.slice(0, 5).map((r, i) => (
                  <li key={r.series_id} role="option" aria-selected={activeIndex.value === i}>
                    <ResultItem
                      cover={r.series_cover_url}
                      name={r.series_name}
                      meta={[r.series_year, r.series_publisher].filter(Boolean).join(" · ")}
                      href={`/series/${r.series_id}`}
                      active={activeIndex.value === i}
                      onHover={() => { activeIndex.value = i; }}
                    />
                  </li>
                ))}
                {libraryResults.value.length === SEARCH_RESULT_LIMIT && (
                  <li role="presentation">
                    <a
                      href={`/search?q=${encodeURIComponent(query.value.trim())}`}
                      class="flex items-center gap-1.5 border-t border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-amber-500 transition-colors hover:bg-slate-800/60"
                    >
                      See all library results
                      <div
                        aria-hidden="true"
                        style={{
                          mask: "url(/icons/arrow-forward.svg) no-repeat center",
                          maskSize: "contain",
                          backgroundColor: "currentColor",
                          width: "12px",
                          height: "12px",
                          flexShrink: 0,
                        }}
                      />
                    </a>
                  </li>
                )}
              </>
            )}

            {/* ComicVine section */}
            {cvResults.value.length > 0 && (
              <>
                <li role="presentation">
                  <SectionLabel loading={loadingCV.value}>ComicVine</SectionLabel>
                </li>
                {cvResults.value.slice(0, 5).map((r, i) => (
                  <li key={r.id} role="option" aria-selected={activeIndex.value === cvOffset.value + i}>
                    <ResultItem
                      cover={r.cover_url}
                      name={r.name}
                      meta={[r.start_year, r.publisher].filter(Boolean).join(" · ")}
                      href={`/series/${r.id}`}
                      active={activeIndex.value === cvOffset.value + i}
                      onHover={() => { activeIndex.value = cvOffset.value + i; }}
                    />
                  </li>
                ))}
                {cvResults.value.length === SEARCH_RESULT_LIMIT && (
                  <li role="presentation">
                    <a
                      href={`/search?q=${encodeURIComponent(query.value.trim())}`}
                      class="flex items-center gap-1.5 border-t border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-amber-500 transition-colors hover:bg-slate-800/60"
                    >
                      See all ComicVine results
                      <div
                        aria-hidden="true"
                        style={{
                          mask: "url(/icons/arrow-forward.svg) no-repeat center",
                          maskSize: "contain",
                          backgroundColor: "currentColor",
                          width: "12px",
                          height: "12px",
                          flexShrink: 0,
                        }}
                      />
                    </a>
                  </li>
                )}
              </>
            )}

          </ul>
        )}

        {/* Loading state — before any results arrive */}
        {query.value.trim() && loading.value && !hasAnyResults.value && (
          <p class="px-4 py-4 text-xs text-slate-500">Searching…</p>
        )}

        {/* Empty state */}
        {query.value.trim() && !loading.value && !hasAnyResults.value && (
          <p class="px-4 py-4 text-xs text-slate-500">
            No results for <span class="text-slate-300">"{query.value}"</span>
          </p>
        )}
      </div>
    </dialog>
  );
}
