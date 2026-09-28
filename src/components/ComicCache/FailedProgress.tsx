import { offlineComics } from "@lib/offline/database";
import {
	discardFailedProgress,
	listFailedProgress,
} from "@lib/offline/progress-sync";
import type { OfflineProgressRecord } from "@lib/offline/types";
import { $offline } from "@stores/offline.store";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

type FailedEntry = { record: OfflineProgressRecord; title: string };

async function loadFailedEntries(): Promise<FailedEntry[]> {
	const records = await listFailedProgress();
	return Promise.all(
		records.map(async (record) => {
			const comic = await offlineComics
				.get(record.issueId)
				.catch(() => undefined);
			return {
				record,
				title: comic
					? `${comic.seriesName} #${comic.issueNumber}`
					: `Issue ${record.issueId}`,
			};
		}),
	);
}

/** Reading progress the server rejected, with a way to drop each record. */
export function FailedProgress() {
	const [entries, setEntries] = useState<FailedEntry[]>([]);
	const [discardError, setDiscardError] = useState(false);
	const latestLoad = useRef(0);

	const reload = useCallback(() => {
		const load = ++latestLoad.current;
		void loadFailedEntries()
			.catch(() => [])
			.then((next) => {
				// Drop a slow load that a newer one has overtaken.
				if (load === latestLoad.current) setEntries(next);
			});
	}, []);

	// Every sync pass republishes $offline, so this also catches a record
	// replaced by a newer save without the failed count changing.
	useEffect(() => {
		reload();
		const unsubscribe = $offline.listen(reload);
		return () => {
			latestLoad.current += 1;
			unsubscribe();
		};
	}, [reload]);

	const discard = useCallback(
		async (issueId: string) => {
			setDiscardError(false);
			try {
				await discardFailedProgress(issueId);
			} catch (error) {
				console.warn("[offline] Could not discard reading progress", error);
				setDiscardError(true);
			}
			reload();
		},
		[reload],
	);

	if (entries.length === 0) return null;

	return (
		<section class="mb-8 flex flex-col gap-3">
			<div
				role="alert"
				class="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300"
			>
				The server rejected this reading progress, so it can’t sync. Discard it
				to use the progress saved on the server.
			</div>
			{discardError && (
				<p role="alert" class="text-sm text-red-300">
					Couldn’t discard this progress. Try again.
				</p>
			)}
			<ol class="divide-y divide-slate-800 border border-slate-800">
				{entries.map(({ record, title }) => (
					<li
						key={record.issueId}
						class="flex flex-wrap items-center justify-between gap-4 bg-slate-900 p-4"
					>
						<div class="min-w-0">
							<a
								href={`/comic/${encodeURIComponent(record.issueId)}`}
								class="block truncate text-sm font-bold text-white transition-colors hover:text-amber-400"
							>
								{title}
							</a>
							<p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
								Page {record.currentPage}
								{record.totalPages ? ` of ${record.totalPages}` : ""}
								{record.lastError ? ` · ${record.lastError}` : ""}
							</p>
						</div>
						<button
							type="button"
							aria-label={`Discard progress for ${title}`}
							class="inline-flex h-12 items-center justify-center border border-slate-700 bg-slate-800 px-4 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-red-400 hover:text-red-300"
							onClick={() => void discard(record.issueId)}
						>
							Discard
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}
