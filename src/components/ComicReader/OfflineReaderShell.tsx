import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ComicReader } from "./ComicReader";
import type { OfflineReaderBootstrap } from "./offlineReader";
import {
	loadOfflineReaderBootstrap,
	OFFLINE_READER_ERROR,
} from "./offlineReader";

export function OfflineReaderShell() {
	const bootstrap = useSignal<OfflineReaderBootstrap | null>(null);
	const error = useSignal<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadOfflineReaderBootstrap(window.location.pathname)
			.then((result) => {
				if (!cancelled) bootstrap.value = result;
			})
			.catch(() => {
				if (!cancelled) error.value = OFFLINE_READER_ERROR;
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (error.value) {
		return (
			<main
				class="flex h-dvh w-dvw flex-col items-center justify-center gap-5 bg-black px-6 text-center"
				role="alert"
			>
				<div class="max-w-sm space-y-2">
					<h1 class="text-lg font-bold text-white">Saved comic unavailable</h1>
					<p class="text-sm leading-6 text-slate-400">{error.value}</p>
				</div>
				<a
					href="/cache"
					class="bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500"
				>
					Back to saved comics
				</a>
			</main>
		);
	}

	if (!bootstrap.value) {
		return (
			<div
				class="flex h-dvh w-dvw items-center justify-center bg-black"
				role="status"
				aria-live="polite"
			>
				<p class="text-sm font-bold uppercase tracking-widest text-slate-400">
					Opening saved comic…
				</p>
			</div>
		);
	}

	return <ComicReader {...bootstrap.value} />;
}
