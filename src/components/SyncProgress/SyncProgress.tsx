import { Icon } from "@components/Icon/Icon";
import type { EnrichmentMonitorSnapshot } from "@data/elastic/syncRuns";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

const POLL_INTERVAL_MS = 15_000;

type LoadState = "loading" | "ready" | "error";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/**
 * Keeps percentage values inside the valid progressbar range.
 *
 * @param value - Raw percentage value.
 * @returns A percentage between 0 and 100.
 */
function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

/**
 * Formats numeric sync counters for compact dashboard display.
 *
 * @param value - Raw counter value.
 * @returns Locale-aware formatted number.
 */
function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

/**
 * Formats optional ISO timestamps for the latest-run summary.
 *
 * @param value - Optional ISO timestamp.
 * @returns Localized date/time label or a fallback when absent/invalid.
 */
function formatDateTime(value?: string | null): string {
	if (!value) return "Not recorded";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Not recorded";
	return DATE_FORMAT.format(date);
}

/**
 * Derives the short status label displayed beside the latest enrichment run.
 *
 * @param snapshot - Current enrichment monitor snapshot.
 * @returns Human-readable run status label.
 */
function statusLabel(snapshot: EnrichmentMonitorSnapshot): string {
	const run = snapshot.latestRun;
	if (!run) return "No run";
	if (snapshot.isLatestRunStale) return "Stale";
	if (run.status === "running") return "Running";
	if (run.status === "completed") return "Completed";
	return "Failed";
}

/**
 * Chooses the border/text colors for the latest-run status badge.
 *
 * @param snapshot - Current enrichment monitor snapshot.
 * @returns Tailwind class string for the status badge state.
 */
function statusClass(snapshot: EnrichmentMonitorSnapshot): string {
	const run = snapshot.latestRun;
	if (!run) return "border-slate-700 text-slate-400";
	if (snapshot.isLatestRunStale) return "border-amber-500 text-amber-400";
	if (run.status === "running") return "border-amber-500 text-amber-400";
	if (run.status === "completed") return "border-emerald-700 text-emerald-300";
	return "border-red-900 text-red-300";
}

/**
 * Renders one numeric metric in the enrichment overview grid.
 *
 * @param props - Metric label and already-formatted value.
 */
function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div class="bg-slate-900 p-4">
			<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
				{label}
			</p>
			<p class="mt-2 text-3xl font-black text-white">{value}</p>
		</div>
	);
}

/** Renders the initial loading state while the first status request is pending. */
function ProgressSkeleton() {
	return (
		<div
			class="border border-slate-800 bg-slate-900 p-6"
			role="status"
			aria-live="polite"
		>
			<div class="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-slate-500">
				<Icon name="sync" class="h-4 w-4" />
				Reading sync status
			</div>
		</div>
	);
}

/** Renders the live ComicVine enrichment monitor and polling behavior. */
export function SyncProgress() {
	const [snapshot, setSnapshot] = useState<EnrichmentMonitorSnapshot | null>(
		null,
	);
	const [state, setState] = useState<LoadState>("loading");
	const [error, setError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);

	const loadSnapshot = useCallback(async (initial = false) => {
		abortControllerRef.current?.abort();
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		if (initial) setState("loading");
		else setIsRefreshing(true);
		setError(null);

		try {
			const response = await fetch("/api/sync-runs/enrichment", {
				signal: abortController.signal,
				headers: { Accept: "application/json" },
			});

			if (!response.ok) throw new Error("Failed to fetch enrichment status.");

			const nextSnapshot = (await response.json()) as EnrichmentMonitorSnapshot;
			setSnapshot(nextSnapshot);
			setState("ready");
		} catch (loadError) {
			if (
				loadError instanceof DOMException &&
				loadError.name === "AbortError"
			) {
				return;
			}

			setError("Failed to load enrichment status.");
			setState((currentState) =>
				currentState === "ready" ? currentState : "error",
			);
		} finally {
			if (abortControllerRef.current === abortController) {
				abortControllerRef.current = null;
			}
			setIsRefreshing(false);
		}
	}, []);

	useEffect(() => {
		let intervalId: number | undefined;

		const schedulePolling = () => {
			if (intervalId) window.clearInterval(intervalId);
			if (document.visibilityState === "visible") {
				intervalId = window.setInterval(() => {
					void loadSnapshot(false);
				}, POLL_INTERVAL_MS);
			}
		};

		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") void loadSnapshot(false);
			schedulePolling();
		};

		void loadSnapshot(true);
		schedulePolling();
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			if (intervalId) window.clearInterval(intervalId);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			abortControllerRef.current?.abort();
		};
	}, [loadSnapshot]);

	if (state === "loading") return <ProgressSkeleton />;

	if (state === "error" || !snapshot) {
		return (
			<div class="flex flex-col gap-4 border border-red-950 bg-red-950/40 p-6">
				<p class="text-sm text-red-300">
					{error ?? "Failed to load enrichment status."}
				</p>
				<button
					type="button"
					class="inline-flex h-12 w-fit items-center gap-2 border border-red-900 bg-red-950 px-4 text-xs font-bold uppercase tracking-widest text-red-300 transition-colors hover:border-red-400 hover:text-red-200 disabled:cursor-wait disabled:opacity-60"
					onClick={() => void loadSnapshot(true)}
					disabled={isRefreshing}
				>
					<Icon name="sync" class="h-4 w-4" />
					Retry
				</button>
			</div>
		);
	}

	const { overview, latestRun } = snapshot;
	const percentComplete = clampPercent(overview.percentComplete);
	const currentIssue = [
		latestRun?.current_series_name,
		latestRun?.current_issue_number
			? `#${latestRun.current_issue_number}`
			: undefined,
		latestRun?.current_issue_name,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<section class="flex flex-col gap-6" aria-live="polite">
			<div class="grid gap-px overflow-hidden border border-slate-800 bg-slate-800 sm:grid-cols-4">
				<Metric
					label="Total issues"
					value={formatNumber(overview.totalIssues)}
				/>
				<Metric
					label="Enriched"
					value={formatNumber(overview.enrichedIssues)}
				/>
				<Metric label="Pending" value={formatNumber(overview.pendingIssues)} />
				<Metric label="Coverage" value={`${percentComplete}%`} />
			</div>

			<div class="border border-slate-800 bg-slate-900 p-5">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							ComicVine coverage
						</p>
						<p class="mt-2 text-sm text-slate-400">
							{formatNumber(overview.enrichedIssues)} of{" "}
							{formatNumber(overview.totalIssues)} issues
						</p>
					</div>
					<button
						type="button"
						class="inline-flex h-12 items-center gap-2 border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-amber-500 hover:text-amber-400 disabled:cursor-wait disabled:opacity-60"
						onClick={() => void loadSnapshot(false)}
						disabled={isRefreshing}
					>
						<Icon name="sync" class="h-4 w-4" />
						{isRefreshing ? "Refreshing" : "Refresh"}
					</button>
				</div>

				<div
					class="mt-5 h-1 bg-slate-800"
					role="progressbar"
					aria-label="ComicVine enrichment coverage"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percentComplete}
				>
					<div
						class="h-1 bg-amber-500 transition-[width] duration-200 ease-in-out"
						style={{ width: `${percentComplete}%` }}
					/>
				</div>

				{error ? <p class="mt-4 text-sm text-red-300">{error}</p> : null}
			</div>

			<div class="border border-slate-800 bg-slate-900 p-5">
				<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
					<div>
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Latest enrichment run
						</p>
						<p class="mt-2 text-sm font-bold uppercase tracking-widest text-slate-300">
							{latestRun?.run_id ?? "No run recorded"}
						</p>
					</div>
					<span
						class={`inline-flex h-9 items-center border px-3 text-[10px] font-bold uppercase tracking-widest ${statusClass(snapshot)}`}
					>
						{statusLabel(snapshot)}
					</span>
				</div>

				<div class="grid gap-px bg-slate-800 md:grid-cols-3">
					<div class="bg-slate-900 py-4 pr-4 md:px-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Started
						</p>
						<p class="mt-2 text-sm text-slate-300">
							{formatDateTime(latestRun?.started_at)}
						</p>
					</div>
					<div class="bg-slate-900 py-4 pr-4 md:px-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Updated
						</p>
						<p class="mt-2 text-sm text-slate-300">
							{formatDateTime(latestRun?.updated_at)}
						</p>
					</div>
					<div class="bg-slate-900 py-4 pr-4 md:px-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Completed
						</p>
						<p class="mt-2 text-sm text-slate-300">
							{formatDateTime(latestRun?.completed_at)}
						</p>
					</div>
				</div>

				<div class="mt-5 grid gap-4 md:grid-cols-2">
					<div>
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Series progress
						</p>
						<p class="mt-2 text-sm text-slate-300">
							{latestRun
								? `${formatNumber(latestRun.series_synced)} of ${formatNumber(latestRun.series_total)}`
								: "Not recorded"}
						</p>
					</div>
					<div>
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Issues enriched this run
						</p>
						<p class="mt-2 text-sm text-slate-300">
							{latestRun
								? formatNumber(latestRun.issues_enriched)
								: "Not recorded"}
						</p>
					</div>
				</div>

				{currentIssue ? (
					<div class="mt-5 border-t border-slate-800 pt-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600">
							Current issue
						</p>
						<p class="mt-2 text-sm text-slate-300">{currentIssue}</p>
					</div>
				) : null}

				{latestRun?.last_error ? (
					<div class="mt-5 border border-red-950 bg-red-950/40 p-4 text-sm text-red-300">
						{latestRun.last_error}
					</div>
				) : null}
			</div>
		</section>
	);
}
