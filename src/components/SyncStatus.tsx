import { derivePwaUiStatus, type PwaUiStatus } from "@lib/pwa/lifecycle";
import { useStore } from "@nanostores/preact";
import { $offline } from "@stores/offline.store";

const STATUS_LABELS: Record<PwaUiStatus, { short: string; long: string }> = {
	offline: { short: "Offline", long: "Offline" },
	preparing: { short: "Saving", long: "Preparing offline" },
	ready: { short: "Ready", long: "Ready offline" },
	unavailable: { short: "Online", long: "Online only" },
};

const STATUS_CLASSES: Record<PwaUiStatus, string> = {
	offline: "border-amber-500/50 bg-amber-500/10 text-amber-400",
	preparing: "border-slate-700 bg-slate-800 text-slate-300",
	ready: "border-slate-700 bg-slate-800 text-slate-300",
	unavailable: "border-red-900/80 bg-red-950 text-red-300",
};

function describeUnsynced(pending: number, failed: number): string {
	const waiting = `${pending} reading progress ${pending === 1 ? "update" : "updates"} waiting to sync`;
	return failed > 0 ? `${waiting}, ${failed} failed` : waiting;
}

/** Header connectivity pill, unsynced progress count and sign-in prompt. */
export function SyncStatus() {
	const { online, shellReady, pendingProgress, failedProgress, authRequired } =
		useStore($offline);
	const status = derivePwaUiStatus({
		online,
		ready: shellReady,
		supported: "serviceWorker" in navigator,
	});
	const unsynced = pendingProgress + failedProgress;
	const label = STATUS_LABELS[status];

	return (
		<>
			{authRequired && (
				<a
					href="/login"
					class="group inline-flex h-12 shrink-0 items-center focus-visible:outline-none"
				>
					<span class="inline-flex h-7 items-center border border-amber-500/50 bg-amber-500/10 px-2 text-[10px] font-bold uppercase tracking-widest text-amber-500 transition-colors group-hover:border-amber-400 group-hover:text-amber-400 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-amber-500">
						Sign in to sync
					</span>
				</a>
			)}
			<span
				hidden={unsynced === 0}
				role="status"
				aria-live="polite"
				aria-atomic="true"
				aria-label={describeUnsynced(pendingProgress, failedProgress)}
				class={`inline-flex h-7 min-w-7 items-center justify-center px-2 text-[10px] font-black tabular-nums ${
					failedProgress > 0
						? "bg-red-900 text-red-200"
						: "bg-amber-500 text-slate-950"
				}`}
			>
				{unsynced}
			</span>
			<div
				role="status"
				aria-live="polite"
				aria-atomic="true"
				data-status={status}
				class={`mr-1 inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 text-[10px] font-bold uppercase tracking-widest ${STATUS_CLASSES[status]}`}
			>
				<span class="h-1.5 w-1.5 bg-current" aria-hidden="true"></span>
				<span class="sm:hidden">{label.short}</span>
				<span class="hidden sm:inline">{label.long}</span>
			</div>
		</>
	);
}
