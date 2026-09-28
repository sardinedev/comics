import { $isOffline } from "@stores/offline.store";
import type { ReadableAtom } from "nanostores";
import { offlineComics } from "./database";
import type { OfflineComicRecord } from "./types";

/** A browser connectivity source that can be replaced in component tests. */
export type OfflineStatusSource = {
	isOffline: () => boolean;
	subscribe: (listener: (offline: boolean) => void) => () => void;
};

/** Reads connectivity from the offline store the PWA client keeps current. */
export function createOfflineStatusSource(
	store: ReadableAtom<boolean> = $isOffline,
): OfflineStatusSource {
	return {
		isOffline: () => store.get(),
		subscribe: (listener) => store.listen(listener),
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
