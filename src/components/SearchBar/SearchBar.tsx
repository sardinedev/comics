import { SEARCH_RESULT_LIMIT } from "@data/search.constants";
import {
	createOfflineStatusSource,
	type OfflineStatusSource,
	searchDownloadedComics,
} from "@lib/offline/search";
import type { OfflineComicRecord } from "@lib/offline/types";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

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

type VisibleResult =
	| ({ type: "library" } & LibraryResult)
	| ({ type: "cv" } & CVResult)
	| ({ type: "downloaded" } & OfflineComicRecord);

const RESULT_PREVIEW_LIMIT = 5;
const SEARCH_DEBOUNCE_MS = 250;

async function readSearchResponse<T>(
	url: string,
	signal: AbortSignal,
): Promise<T[]> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`Search failed (${response.status})`);
	return response.json() as Promise<T[]>;
}

function issueLabel(comic: OfflineComicRecord): string {
	return `${comic.seriesName} #${comic.issueNumber}`;
}

function downloadedIssueMeta(comic: OfflineComicRecord): string {
	return ["Downloaded", comic.issueName, comic.seriesYear]
		.filter(Boolean)
		.join(" · ");
}

function ResultItem({
	cover,
	name,
	meta,
	href,
	active,
	onHover,
}: {
	cover?: string;
	name: string;
	meta: string;
	href: string;
	active: boolean;
	onHover: () => void;
}) {
	return (
		<a
			href={href}
			class={`flex items-center gap-3 px-4 py-3 transition-colors sm:py-2.5 ${active ? "bg-slate-800" : "hover:bg-slate-800/60"}`}
			onMouseEnter={onHover}
		>
			<div class="h-12 w-8 flex-shrink-0 overflow-hidden bg-slate-800 ring-1 ring-white/5 sm:h-11">
				{cover ? (
					<img
						src={cover}
						alt={`${name} cover`}
						class="h-full w-full object-cover"
						loading="lazy"
					/>
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
				<p class="truncate text-sm font-bold leading-tight text-white">
					{name}
				</p>
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

function SectionLabel({
	children,
	loading,
}: {
	children: string;
	loading: boolean;
}) {
	return (
		<div class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
			<span class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
				{children}
			</span>
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

export function SearchBar({
	connectivity,
}: {
	/** Test seam for connectivity without changing browser globals. */
	connectivity?: OfflineStatusSource;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const connectivityRef = useRef<OfflineStatusSource | null>(null);
	connectivityRef.current ??= connectivity ?? createOfflineStatusSource();

	const [query, setQuery] = useState("");
	const [libraryResults, setLibraryResults] = useState<LibraryResult[]>([]);
	const [cvResults, setCvResults] = useState<CVResult[]>([]);
	const [downloadedResults, setDownloadedResults] = useState<
		OfflineComicRecord[]
	>([]);
	const [loadingLibrary, setLoadingLibrary] = useState(false);
	const [loadingCV, setLoadingCV] = useState(false);
	const [loadingDownloaded, setLoadingDownloaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [offline, setOffline] = useState(
		() => connectivityRef.current?.isOffline() ?? false,
	);
	const [activeIndex, setActiveIndex] = useState(-1);

	const visibleResults = useMemo<VisibleResult[]>(
		() =>
			offline
				? downloadedResults
						.slice(0, RESULT_PREVIEW_LIMIT)
						.map((result) => ({ type: "downloaded", ...result }))
				: [
						...libraryResults
							.slice(0, RESULT_PREVIEW_LIMIT)
							.map((result) => ({ type: "library" as const, ...result })),
						...cvResults
							.slice(0, RESULT_PREVIEW_LIMIT)
							.map((result) => ({ type: "cv" as const, ...result })),
					],
		[cvResults, downloadedResults, libraryResults, offline],
	);
	const cvOffset = Math.min(libraryResults.length, RESULT_PREVIEW_LIMIT);
	const loading = loadingLibrary || loadingCV || loadingDownloaded;
	const hasAnyResults = visibleResults.length > 0;

	useEffect(() => {
		return connectivityRef.current?.subscribe((nextOffline) => {
			setOffline(nextOffline);
			setActiveIndex(-1);
		});
	}, []);

	useEffect(() => {
		function openDialog() {
			setQuery("");
			setLibraryResults([]);
			setCvResults([]);
			setDownloadedResults([]);
			setLoadingLibrary(false);
			setLoadingCV(false);
			setLoadingDownloaded(false);
			setError(null);
			setActiveIndex(-1);
			setOffline(connectivityRef.current?.isOffline() ?? false);
			dialogRef.current?.showModal();
			requestAnimationFrame(() => inputRef.current?.focus());
		}

		// "open-search" is dispatched by the search button in Header.astro.
		window.addEventListener("open-search", openDialog);
		return () => window.removeEventListener("open-search", openDialog);
	}, []);

	useEffect(() => {
		const trimmedQuery = query.trim();
		setActiveIndex(-1);
		setError(null);
		if (!trimmedQuery) {
			setLibraryResults([]);
			setCvResults([]);
			setDownloadedResults([]);
			setLoadingLibrary(false);
			setLoadingCV(false);
			setLoadingDownloaded(false);
			return;
		}

		const abortController = new AbortController();
		let current = true;
		const timer = window.setTimeout(async () => {
			if (offline) {
				setLibraryResults([]);
				setCvResults([]);
				setLoadingLibrary(false);
				setLoadingCV(false);
				setLoadingDownloaded(true);
				try {
					const results = await searchDownloadedComics(trimmedQuery);
					if (current) setDownloadedResults(results);
				} catch {
					if (current) {
						setDownloadedResults([]);
						setError("Downloaded comics could not be searched.");
					}
				} finally {
					if (current) setLoadingDownloaded(false);
				}
				return;
			}

			setDownloadedResults([]);
			setLoadingDownloaded(false);
			setLoadingLibrary(true);
			setLoadingCV(true);
			const encodedQuery = encodeURIComponent(trimmedQuery);
			const [library, comicVine] = await Promise.allSettled([
				readSearchResponse<LibraryResult>(
					`/api/search?q=${encodedQuery}`,
					abortController.signal,
				),
				readSearchResponse<CVResult>(
					`/api/search/comicvine?q=${encodedQuery}`,
					abortController.signal,
				),
			]);
			if (!current) return;

			setLibraryResults(library.status === "fulfilled" ? library.value : []);
			setCvResults(comicVine.status === "fulfilled" ? comicVine.value : []);
			setLoadingLibrary(false);
			setLoadingCV(false);
			if (library.status === "rejected" && comicVine.status === "rejected") {
				setError("Online search is unavailable. Try again when connected.");
			}
		}, SEARCH_DEBOUNCE_MS);

		return () => {
			current = false;
			window.clearTimeout(timer);
			abortController.abort();
		};
	}, [offline, query]);

	function onKeyDown(event: KeyboardEvent) {
		if (visibleResults.length === 0) return;

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((current) =>
				Math.min(current + 1, visibleResults.length - 1),
			);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((current) => Math.max(current - 1, 0));
		} else if (event.key === "Enter" && activeIndex >= 0) {
			event.preventDefault();
			const hit = visibleResults[activeIndex];
			if (hit?.type === "downloaded") {
				window.location.href = `/comic/${encodeURIComponent(hit.issueId)}/read`;
			} else if (hit?.type === "library") {
				window.location.href = `/series/${hit.series_id}`;
			} else if (hit?.type === "cv") {
				window.location.href = `/series/${hit.id}`;
			}
		}
	}

	function onDialogClick(event: MouseEvent) {
		if (event.target === dialogRef.current) dialogRef.current?.close();
	}

	function onDialogKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") dialogRef.current?.close();
	}

	return (
		<dialog
			ref={dialogRef}
			onClick={onDialogClick}
			onKeyDown={onDialogKeyDown}
			data-scroll="Dialog"
			class="m-0 w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
			style="top: 0; left: 0; height: 100dvh; max-height: 100dvh;"
			aria-label={offline ? "Search downloaded comics" : "Search series"}
		>
			<div class="w-full border-b border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 sm:mx-auto sm:mt-16 sm:max-w-xl sm:border">
				<div class="flex items-center border-b border-slate-800">
					<span
						aria-hidden="true"
						class="ml-4 mr-3 flex-shrink-0"
						style={{
							mask: "url(/icons/search.svg) no-repeat center",
							maskSize: "contain",
							backgroundColor: loading ? "#f59e0b" : "#475569",
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
						placeholder={
							offline ? "Search downloaded comics…" : "Search series…"
						}
						aria-label={offline ? "Search downloaded comics" : "Search series"}
						aria-controls="search-listbox"
						value={query}
						onInput={(event) =>
							setQuery((event.target as HTMLInputElement).value)
						}
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

				{offline && (
					<p
						role="status"
						class="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-400"
					>
						Offline · Searching downloaded comics only
					</p>
				)}

				{hasAnyResults && (
					<ul id="search-listbox" aria-label="Search results">
						{offline && downloadedResults.length > 0 && (
							<>
								<li>
									<SectionLabel loading={loadingDownloaded}>
										Downloaded comics
									</SectionLabel>
								</li>
								{downloadedResults
									.slice(0, RESULT_PREVIEW_LIMIT)
									.map((comic, index) => (
										<li key={comic.issueId}>
											<ResultItem
												cover={comic.coverCacheKey}
												name={issueLabel(comic)}
												meta={downloadedIssueMeta(comic)}
												href={`/comic/${encodeURIComponent(comic.issueId)}/read`}
												active={activeIndex === index}
												onHover={() => setActiveIndex(index)}
											/>
										</li>
									))}
							</>
						)}

						{!offline && libraryResults.length > 0 && (
							<>
								<li>
									<SectionLabel loading={loadingLibrary}>
										In your library
									</SectionLabel>
								</li>
								{libraryResults
									.slice(0, RESULT_PREVIEW_LIMIT)
									.map((result, index) => (
										<li key={result.series_id}>
											<ResultItem
												cover={result.series_cover_url}
												name={result.series_name}
												meta={[result.series_year, result.series_publisher]
													.filter(Boolean)
													.join(" · ")}
												href={`/series/${result.series_id}`}
												active={activeIndex === index}
												onHover={() => setActiveIndex(index)}
											/>
										</li>
									))}
								{libraryResults.length === SEARCH_RESULT_LIMIT && (
									<li>
										<a
											href={`/search?q=${encodeURIComponent(query.trim())}`}
											class="flex items-center gap-1.5 border-t border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-amber-500 transition-colors hover:bg-slate-800/60"
										>
											See all library results
										</a>
									</li>
								)}
							</>
						)}

						{!offline && cvResults.length > 0 && (
							<>
								<li>
									<SectionLabel loading={loadingCV}>ComicVine</SectionLabel>
								</li>
								{cvResults
									.slice(0, RESULT_PREVIEW_LIMIT)
									.map((result, index) => (
										<li key={result.id}>
											<ResultItem
												cover={result.cover_url}
												name={result.name}
												meta={[result.start_year, result.publisher]
													.filter(Boolean)
													.join(" · ")}
												href={`/series/${result.id}`}
												active={activeIndex === cvOffset + index}
												onHover={() => setActiveIndex(cvOffset + index)}
											/>
										</li>
									))}
								{cvResults.length === SEARCH_RESULT_LIMIT && (
									<li>
										<a
											href={`/search?q=${encodeURIComponent(query.trim())}`}
											class="flex items-center gap-1.5 border-t border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-amber-500 transition-colors hover:bg-slate-800/60"
										>
											See all ComicVine results
										</a>
									</li>
								)}
							</>
						)}
					</ul>
				)}

				{query.trim() && loading && !hasAnyResults && (
					<p role="status" class="px-4 py-4 text-xs text-slate-500">
						Searching…
					</p>
				)}

				{error && (
					<p role="alert" class="px-4 py-4 text-xs text-red-300">
						{error}
					</p>
				)}

				{query.trim() && !loading && !hasAnyResults && !error && (
					<p role="status" class="px-4 py-4 text-xs text-slate-500">
						{offline ? "No downloaded comics" : "No results"} for{" "}
						<span class="text-slate-300">"{query}"</span>
					</p>
				)}
			</div>
		</dialog>
	);
}
