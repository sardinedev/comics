import { Icon } from "@components/Icon/Icon";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
	type CachedComic,
	deleteCachedIssue,
	listCachedComics,
} from "./comicCache.utils";

/** Loading state for the browser cache manager island. */
type LoadState = "loading" | "ready" | "unsupported" | "error";

/**
 * Formats a byte count for compact cache summary labels.
 *
 * @param bytes - Raw byte count to format.
 * @returns Human-readable size using binary units.
 */
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

/**
 * Formats the primary title for a cached comic row.
 *
 * @param comic - Cached comic entry to label.
 * @returns Series/issue title, or an issue-id fallback for sidecar-less entries.
 */
function formatIssueTitle(comic: CachedComic): string {
	const metadata = comic.metadata;
	if (!metadata) return `Issue ${comic.issueId}`;

	const issueNumber =
		metadata.issueNumber != null ? ` #${metadata.issueNumber}` : "";
	return `${metadata.seriesName ?? "Comic"}${issueNumber}`;
}

/**
 * Formats secondary metadata for a cached comic row.
 *
 * @param comic - Cached comic entry to summarize.
 * @returns Issue title/date/year details, or a fallback archive label.
 */
function formatIssueMeta(comic: CachedComic): string {
	const metadata = comic.metadata;
	if (!metadata) return "Cached archive";

	const parts = [
		metadata.issueName,
		metadata.issueDate?.slice(0, 10),
		metadata.seriesYear,
	].filter(Boolean);

	return parts.length > 0 ? parts.join(" · ") : "Cached archive";
}

/** Renders the browser cache management UI for cached comic archives. */
export function ComicCacheManager() {
	const [comics, setComics] = useState<CachedComic[]>([]);
	const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
	const [confirmingIssueId, setConfirmingIssueId] = useState<string | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [state, setState] = useState<LoadState>("loading");

	const loadComics = useCallback(async () => {
		if (typeof caches === "undefined") {
			setState("unsupported");
			return;
		}

		setState("loading");
		setError(null);
		setConfirmBulkDelete(false);
		setConfirmingIssueId(null);

		try {
			const cachedComics = await listCachedComics();
			setComics(cachedComics);
			setSelectedIds((current) => {
				const next = new Set<string>();
				const cachedIds = new Set(cachedComics.map((comic) => comic.issueId));
				for (const issueId of current) {
					if (cachedIds.has(issueId)) next.add(issueId);
				}
				return next;
			});
			setState("ready");
		} catch {
			setError("Failed to read the browser cache.");
			setState("error");
		}
	}, []);

	useEffect(() => {
		void loadComics();
	}, [loadComics]);

	const totalSize = useMemo(
		() => comics.reduce((total, comic) => total + comic.sizeBytes, 0),
		[comics],
	);
	const selectedSize = useMemo(
		() =>
			comics
				.filter((comic) => selectedIds.has(comic.issueId))
				.reduce((total, comic) => total + comic.sizeBytes, 0),
		[comics, selectedIds],
	);
	const allSelected = comics.length > 0 && selectedIds.size === comics.length;

	/**
	 * Toggles a single issue in the bulk-delete selection.
	 *
	 * @param issueId - Cached issue id to add or remove from the selection.
	 */
	function toggleIssue(issueId: string) {
		setConfirmBulkDelete(false);
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(issueId)) next.delete(issueId);
			else next.add(issueId);
			return next;
		});
	}

	/** Selects every cached issue, or clears the selection when all are selected. */
	function toggleAll() {
		setConfirmBulkDelete(false);
		setSelectedIds(
			allSelected ? new Set() : new Set(comics.map((comic) => comic.issueId)),
		);
	}

	/**
	 * Removes cached issues and mirrors the deletion in local component state.
	 *
	 * @param issueIds - Cached issue ids to remove.
	 */
	async function removeIssues(issueIds: string[]) {
		await Promise.all(issueIds.map((issueId) => deleteCachedIssue(issueId)));
		setComics((current) =>
			current.filter((comic) => !issueIds.includes(comic.issueId)),
		);
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const issueId of issueIds) next.delete(issueId);
			return next;
		});
		setConfirmBulkDelete(false);
		setConfirmingIssueId(null);
	}

	/**
	 * Handles the two-step delete confirmation for one cached issue.
	 *
	 * @param issueId - Cached issue id targeted by the row action.
	 */
	async function onDeleteIssue(issueId: string) {
		if (confirmingIssueId !== issueId) {
			setConfirmingIssueId(issueId);
			return;
		}
		await removeIssues([issueId]);
	}

	/** Handles the two-step delete confirmation for the selected cached issues. */
	async function onDeleteSelected() {
		const issueIds = [...selectedIds];
		if (issueIds.length === 0) return;
		if (!confirmBulkDelete) {
			setConfirmBulkDelete(true);
			return;
		}
		await removeIssues(issueIds);
	}

	if (state === "loading") {
		return (
			<div
				class="border border-slate-800 bg-slate-900 p-6"
				role="status"
				aria-live="polite"
			>
				<div class="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-slate-500">
					<Icon name="sync" class="h-4 w-4" />
					Reading cache
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
						Selected
					</p>
					<p class="mt-2 text-3xl font-black text-white">
						{formatBytes(selectedSize)}
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
				<label class="inline-flex h-12 items-center gap-3 border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300">
					<input
						type="checkbox"
						class="h-4 w-4 accent-amber-500"
						checked={allSelected}
						onChange={toggleAll}
					/>
					Select all
				</label>

				<div class="flex items-center gap-2">
					<button
						type="button"
						class="inline-flex h-12 items-center gap-2 border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-amber-500 hover:text-amber-500"
						onClick={() => void loadComics()}
					>
						<Icon name="sync" class="h-3.5 w-3.5" />
						Refresh
					</button>
					<button
						type="button"
						class="inline-flex h-12 items-center gap-2 border border-red-900/80 bg-red-950 px-4 text-xs font-bold uppercase tracking-widest text-red-300 transition-colors hover:border-red-400 hover:text-red-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-700"
						disabled={selectedIds.size === 0}
						onClick={() => void onDeleteSelected()}
					>
						{confirmBulkDelete
							? "Confirm delete"
							: `Delete ${selectedIds.size || ""}`}
					</button>
				</div>
			</div>

			{comics.length === 0 ? (
				<div class="border border-slate-800 bg-slate-900 p-8">
					<p class="text-sm text-slate-500">
						No comics are cached in this browser.
					</p>
				</div>
			) : (
				<ol class="divide-y divide-slate-800 border border-slate-800">
					{comics.map((comic) => (
						<li
							key={comic.issueId}
							class="grid gap-4 bg-slate-900 p-4 sm:grid-cols-[auto_56px_minmax(0,1fr)_auto] sm:items-center"
						>
							<div class="flex items-center">
								<input
									type="checkbox"
									class="h-4 w-4 accent-amber-500"
									aria-label={`Select ${formatIssueTitle(comic)}`}
									checked={selectedIds.has(comic.issueId)}
									onChange={() => toggleIssue(comic.issueId)}
								/>
							</div>

							<div class="h-20 w-14 overflow-hidden bg-slate-800 ring-1 ring-white/5">
								{comic.metadata?.coverUrl ? (
									<img
										src={comic.metadata.coverUrl}
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

							<div class="min-w-0">
								<a
									href={`/comic/${comic.issueId}`}
									class="block truncate text-sm font-bold text-white transition-colors hover:text-amber-400"
								>
									{formatIssueTitle(comic)}
								</a>
								<p class="mt-1 truncate text-xs text-slate-500">
									{formatIssueMeta(comic)}
								</p>
								<p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
									{formatBytes(comic.sizeBytes)}
									{comic.metadata?.cachedAt
										? ` · Cached ${comic.metadata.cachedAt.slice(0, 10)}`
										: ""}
								</p>
							</div>

							<button
								type="button"
								aria-label={`${confirmingIssueId === comic.issueId ? "Confirm delete" : "Delete"} ${formatIssueTitle(comic)}`}
								class="inline-flex h-12 items-center justify-center border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-red-400 hover:text-red-300"
								onClick={() => void onDeleteIssue(comic.issueId)}
							>
								{confirmingIssueId === comic.issueId ? "Confirm" : "Delete"}
							</button>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
