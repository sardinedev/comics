import { offlineComics } from "./database";
import type { OfflineComicRecord } from "./types";

/** A browser connectivity source that can be replaced in component tests. */
export type OfflineStatusSource = {
	isOffline: () => boolean;
	subscribe: (listener: (offline: boolean) => void) => () => void;
};

type NavigatorConnectivity = Pick<Navigator, "onLine">;

type PwaStatusEventDetail = {
	status?: "offline" | "preparing" | "ready" | "unavailable";
};

/**
 * Creates a connectivity adapter from browser and PWA lifecycle events.
 *
 * `navigator.onLine` remains the fallback because the PWA client may not have
 * emitted its first status event when this island hydrates.
 */
export function createOfflineStatusSource(
	navigatorObject: NavigatorConnectivity = navigator,
	eventTarget: EventTarget = window,
): OfflineStatusSource {
	let pwaOffline: boolean | null = null;

	return {
		isOffline: () => pwaOffline ?? navigatorObject.onLine === false,
		subscribe: (listener) => {
			const onOnline = () => {
				pwaOffline = false;
				listener(false);
			};
			const onOffline = () => {
				pwaOffline = true;
				listener(true);
			};
			const onPwaStatus = (event: Event) => {
				const status = (event as CustomEvent<PwaStatusEventDetail>).detail
					?.status;
				if (!status) return;
				pwaOffline = status === "offline";
				listener(pwaOffline);
			};

			eventTarget.addEventListener("online", onOnline);
			eventTarget.addEventListener("offline", onOffline);
			eventTarget.addEventListener("comics:pwa-status", onPwaStatus);

			return () => {
				eventTarget.removeEventListener("online", onOnline);
				eventTarget.removeEventListener("offline", onOffline);
				eventTarget.removeEventListener("comics:pwa-status", onPwaStatus);
			};
		},
	};
}

function searchableText(comic: OfflineComicRecord): string {
	return [
		comic.seriesName,
		comic.seriesYear,
		comic.seriesPublisher,
		comic.issueNumber,
		comic.issueName,
		comic.issueDate,
	]
		.filter((value) => value != null)
		.join(" ")
		.toLocaleLowerCase();
}

function compareIssueNumbers(
	left: OfflineComicRecord,
	right: OfflineComicRecord,
): number {
	return String(left.issueNumber).localeCompare(
		String(right.issueNumber),
		undefined,
		{ numeric: true, sensitivity: "base" },
	);
}

/** Search and deterministically order downloaded issue metadata. */
export function filterDownloadedComics(
	comics: OfflineComicRecord[],
	query: string,
): OfflineComicRecord[] {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];

	return comics
		.filter((comic) => {
			const haystack = searchableText(comic);
			return terms.every((term) => haystack.includes(term));
		})
		.sort((left, right) => {
			const bySeries = left.seriesName.localeCompare(
				right.seriesName,
				undefined,
				{
					sensitivity: "base",
				},
			);
			if (bySeries !== 0) return bySeries;
			const byIssue = compareIssueNumbers(left, right);
			return byIssue !== 0
				? byIssue
				: left.issueId.localeCompare(right.issueId);
		});
}

/** Query only the local downloaded-comic metadata repository. */
export async function searchDownloadedComics(
	query: string,
): Promise<OfflineComicRecord[]> {
	return filterDownloadedComics(await offlineComics.getAll(), query);
}
