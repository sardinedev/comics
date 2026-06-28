import {
	type CachedComic,
	type CachedComicMetadata,
	deleteCachedIssue,
	getOfflineComicUrl,
	getOfflineReaderUrl,
	listCachedComics,
	readCachedComicMetadata,
} from "@components/ComicCache/comicCache.utils";
import { ComicReader } from "@components/ComicReader/ComicReader";
import { readReaderProgress } from "@components/ComicReader/readerProgress";
import { Icon } from "@components/Icon/Icon";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

type View =
	| { name: "list" }
	| { name: "detail"; issueId: string }
	| { name: "reader"; issueId: string };

type LoadState = "loading" | "ready" | "unsupported" | "error";

function currentView(): View {
	const path = window.location.pathname;
	const detailMatch = path.match(/^\/offline\/comic\/([^/]+)$/);
	if (detailMatch) {
		return { name: "detail", issueId: decodeURIComponent(detailMatch[1]) };
	}

	const readerMatch = path.match(/^\/offline\/read\/([^/]+)$/);
	if (readerMatch) {
		return { name: "reader", issueId: decodeURIComponent(readerMatch[1]) };
	}

	return { name: "list" };
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** exponent;
	return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatIssueTitle(comic: CachedComic): string {
	const metadata = comic.metadata;
	if (!metadata) return `Issue ${comic.issueId}`;
	return formatMetadataTitle(metadata, comic.issueId);
}

function formatMetadataTitle(
	metadata: CachedComicMetadata | null,
	issueId: string,
): string {
	if (!metadata) return `Issue ${issueId}`;

	const issueNumber =
		metadata.issueNumber != null ? ` #${metadata.issueNumber}` : "";
	return `${metadata.seriesName ?? "Comic"}${issueNumber}`;
}

function formatIssueMeta(metadata: CachedComicMetadata | null): string {
	if (!metadata) return "Cached archive";
	const parts = [
		metadata.issueName,
		metadata.issueDate?.slice(0, 10),
		metadata.seriesPublisher,
		metadata.seriesYear,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : "Cached archive";
}

function visibleCreators(metadata: CachedComicMetadata): string[] {
	return [
		["Writer", metadata.writers],
		["Artist", metadata.artists],
		["Colorist", metadata.colorists],
		["Letterer", metadata.letterers],
		["Cover", metadata.coverArtists],
		["Editor", metadata.editors],
	].flatMap(([label, names]) => {
		const creatorNames = Array.isArray(names) ? names : [];
		return creatorNames.length > 0
			? [`${label}: ${creatorNames.join(", ")}`]
			: [];
	});
}

/** Browser-only offline comic library shell backed by Cache Storage. */
export function OfflineLibrary() {
	const [comics, setComics] = useState<CachedComic[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [state, setState] = useState<LoadState>("loading");
	const [view, setView] = useState<View>(() => currentView());

	const loadComics = useCallback(async () => {
		if (typeof caches === "undefined") {
			setState("unsupported");
			return;
		}

		setState("loading");
		setError(null);
		try {
			setComics(await listCachedComics());
			setState("ready");
		} catch {
			setError("Failed to read cached comics from this browser.");
			setState("error");
		}
	}, []);

	useEffect(() => {
		void loadComics();
	}, [loadComics]);

	useEffect(() => {
		const onPopState = () => setView(currentView());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function navigate(href: string) {
		window.history.pushState({}, "", href);
		setView(currentView());
		window.scrollTo({ top: 0, behavior: "auto" });
	}

	async function removeIssue(issueId: string) {
		await deleteCachedIssue(issueId);
		setComics((current) =>
			current.filter((comic) => comic.issueId !== issueId),
		);
		if (view.name !== "list" && view.issueId === issueId) navigate("/offline");
	}

	const totalSize = useMemo(
		() => comics.reduce((total, comic) => total + comic.sizeBytes, 0),
		[comics],
	);
	const filteredComics = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return comics;
		return comics.filter((comic) =>
			[
				comic.issueId,
				comic.metadata?.seriesName,
				comic.metadata?.issueName,
				comic.metadata?.seriesPublisher,
				comic.metadata?.issueNumber,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(normalizedQuery),
		);
	}, [comics, query]);

	const selectedComic =
		view.name === "list"
			? null
			: (comics.find((comic) => comic.issueId === view.issueId) ?? null);

	if (state === "loading") {
		return (
			<div
				class="border border-slate-800 bg-slate-900 p-6"
				role="status"
				aria-live="polite"
			>
				<div class="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-slate-500">
					<Icon name="sync" class="h-4 w-4" />
					Reading offline shelf
				</div>
			</div>
		);
	}

	if (state === "unsupported") {
		return (
			<div class="border border-slate-800 bg-slate-900 p-6">
				<p class="text-sm text-slate-400">
					Browser cache storage is unavailable in this context.
				</p>
			</div>
		);
	}

	if (state === "error") {
		return (
			<div class="flex flex-col gap-4 border border-red-950 bg-red-950/40 p-6">
				<p class="text-sm text-red-300">{error}</p>
				<button
					type="button"
					class="inline-flex h-12 w-fit items-center gap-2 border border-red-900 bg-red-950 px-4 text-xs font-bold uppercase tracking-widest text-red-300 transition-colors hover:border-red-400 hover:text-red-200"
					onClick={() => void loadComics()}
				>
					Retry
				</button>
			</div>
		);
	}

	if (view.name === "reader") {
		return (
			<ComicReader
				issueId={view.issueId}
				initialPage={readReaderProgress(view.issueId)?.currentPage ?? 1}
				cacheMetadata={selectedComic?.metadata ?? undefined}
				backHref={getOfflineComicUrl(view.issueId)}
				onNavigate={navigate}
				preferStoredProgress
			/>
		);
	}

	if (view.name === "detail") {
		return (
			<OfflineIssueDetail
				issueId={view.issueId}
				comic={selectedComic}
				onBack={() => navigate("/offline")}
				onDelete={() => void removeIssue(view.issueId)}
				onRead={() => navigate(getOfflineReaderUrl(view.issueId))}
			/>
		);
	}

	return (
		<section class="flex flex-col gap-6">
			<div class="grid gap-px overflow-hidden border border-slate-800 bg-slate-800 sm:grid-cols-3">
				<div class="bg-slate-900 p-4">
					<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
						Cached comics
					</p>
					<p class="mt-2 text-3xl font-black text-white">{comics.length}</p>
				</div>
				<div class="bg-slate-900 p-4">
					<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
						Storage used
					</p>
					<p class="mt-2 text-3xl font-black text-white">
						{formatBytes(totalSize)}
					</p>
				</div>
				<div class="bg-slate-900 p-4">
					<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
						Mode
					</p>
					<p class="mt-2 text-3xl font-black text-white">Offline</p>
				</div>
			</div>

			<label class="flex flex-col gap-2 border-b border-slate-800 pb-4">
				<span class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
					Filter cached comics
				</span>
				<input
					type="search"
					value={query}
					onInput={(event) => setQuery(event.currentTarget.value)}
					class="h-12 border border-slate-700 bg-slate-950 px-4 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-amber-500"
					placeholder="Series, issue, publisher"
				/>
			</label>

			{filteredComics.length === 0 ? (
				<div class="border border-slate-800 bg-slate-900 p-8">
					<p class="text-sm text-slate-500">
						{comics.length === 0
							? "No comics are cached in this browser."
							: "No cached comics match that filter."}
					</p>
				</div>
			) : (
				<ol class="divide-y divide-slate-800 border border-slate-800">
					{filteredComics.map((comic) => (
						<li
							key={comic.issueId}
							class="grid gap-4 bg-slate-900 p-4 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center"
						>
							<Cover metadata={comic.metadata} />

							<div class="min-w-0">
								<button
									type="button"
									class="block max-w-full truncate text-left text-sm font-bold text-white transition-colors hover:text-amber-400"
									onClick={() => navigate(getOfflineComicUrl(comic.issueId))}
								>
									{formatIssueTitle(comic)}
								</button>
								<p class="mt-1 truncate text-xs text-slate-500">
									{formatIssueMeta(comic.metadata)}
								</p>
								<p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
									{formatBytes(comic.sizeBytes)}
									{comic.metadata?.cachedAt
										? ` · Cached ${comic.metadata.cachedAt.slice(0, 10)}`
										: ""}
								</p>
							</div>

							<div class="flex flex-wrap gap-2 sm:justify-end">
								<button
									type="button"
									class="inline-flex h-12 items-center gap-2 border border-amber-500 bg-amber-500 px-4 text-xs font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400"
									onClick={() => navigate(getOfflineReaderUrl(comic.issueId))}
								>
									<Icon name="arrow-forward" class="h-3.5 w-3.5" />
									Read
								</button>
								<button
									type="button"
									aria-label={`Delete ${formatIssueTitle(comic)}`}
									class="inline-flex h-12 items-center justify-center border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-red-400 hover:text-red-300"
									onClick={() => void removeIssue(comic.issueId)}
								>
									Delete
								</button>
							</div>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function Cover({ metadata }: { metadata: CachedComicMetadata | null }) {
	return (
		<div class="h-20 w-14 overflow-hidden bg-slate-800 ring-1 ring-white/5">
			{metadata?.coverUrl ? (
				<img
					src={metadata.coverUrl}
					alt=""
					class="h-full w-full object-cover"
					loading="lazy"
				/>
			) : (
				<div class="flex h-full w-full items-center justify-center text-slate-600">
					<Icon name="image-placeholder" class="h-6 w-6" />
				</div>
			)}
		</div>
	);
}

function OfflineIssueDetail({
	issueId,
	comic,
	onBack,
	onDelete,
	onRead,
}: {
	issueId: string;
	comic: CachedComic | null;
	onBack: () => void;
	onDelete: () => void;
	onRead: () => void;
}) {
	const [metadata, setMetadata] = useState<CachedComicMetadata | null>(
		comic?.metadata ?? null,
	);

	useEffect(() => {
		let cancelled = false;
		if (comic?.metadata) {
			setMetadata(comic.metadata);
			return;
		}

		void readCachedComicMetadata(issueId).then((entry) => {
			if (!cancelled) setMetadata(entry);
		});

		return () => {
			cancelled = true;
		};
	}, [comic?.metadata, issueId]);

	const progress = readReaderProgress(issueId);
	const title = comic
		? formatIssueTitle(comic)
		: formatMetadataTitle(metadata, issueId);
	const creatorLines = metadata ? visibleCreators(metadata) : [];

	return (
		<section class="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
			<div class="flex flex-col gap-4">
				<button
					type="button"
					class="inline-flex h-12 w-fit items-center gap-2 border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-amber-500 hover:text-amber-500"
					onClick={onBack}
				>
					<Icon name="arrow-back" class="h-3.5 w-3.5" />
					Offline shelf
				</button>
				<div class="aspect-[2/3] w-full max-w-60 overflow-hidden bg-slate-800 ring-1 ring-white/10">
					{metadata?.coverUrl ? (
						<img
							src={metadata.coverUrl}
							alt=""
							class="h-full w-full object-cover"
						/>
					) : (
						<div class="flex h-full w-full items-center justify-center text-slate-600">
							<Icon name="image-placeholder" class="h-10 w-10" />
						</div>
					)}
				</div>
			</div>

			<div class="flex min-w-0 flex-col gap-6">
				<div class="border-b border-slate-800 pb-6">
					<p class="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-amber-500">
						Offline issue
					</p>
					<h2 class="font-serif text-4xl font-black leading-tight text-white">
						{title}
					</h2>
					<p class="mt-2 text-sm text-slate-500">{formatIssueMeta(metadata)}</p>
				</div>

				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="inline-flex h-12 items-center gap-2 bg-amber-500 px-5 text-xs font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400"
						onClick={onRead}
					>
						<Icon name="arrow-forward" class="h-3.5 w-3.5" />
						Read cached issue
					</button>
					<button
						type="button"
						class="inline-flex h-12 items-center gap-2 border border-slate-700 bg-slate-800 px-5 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-red-400 hover:text-red-300"
						onClick={onDelete}
					>
						Delete
					</button>
				</div>

				{progress && (
					<div class="border border-slate-800 bg-slate-900 p-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Saved progress
						</p>
						<p class="mt-2 text-sm font-semibold text-slate-300">
							Page {progress.currentPage} of {progress.totalPages}
						</p>
					</div>
				)}

				{metadata?.issueDescription && (
					<p class="max-w-3xl text-sm leading-6 text-slate-300">
						{metadata.issueDescription}
					</p>
				)}

				{creatorLines.length > 0 && (
					<ul class="grid gap-2 border-t border-slate-800 pt-4 text-sm text-slate-400 sm:grid-cols-2">
						{creatorLines.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
