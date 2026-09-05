import { describe, expect, test } from "vitest";
import { filterDownloadedComics } from "./search";
import type { OfflineComicRecord } from "./types";

function comic(
	issueId: string,
	seriesName: string,
	issueNumber: number | string,
	overrides: Partial<OfflineComicRecord> = {},
): OfflineComicRecord {
	return {
		issueId,
		seriesId: `series-${seriesName}`,
		seriesName,
		issueNumber,
		archiveCacheKey: `/api/comic/${issueId}/download`,
		sizeBytes: 1024,
		cachedAt: "2026-08-16T10:00:00.000Z",
		updatedAt: "2026-08-16T10:00:00.000Z",
		...overrides,
	};
}

describe("filterDownloadedComics", () => {
	test("matches every normalized term across downloaded metadata", () => {
		const comics = [
			comic("saga-10", "Saga", 10, {
				issueName: "The War for Phang",
				seriesPublisher: "Image",
			}),
			comic("saga-2", "Saga", 2, { issueName: "Waking Up" }),
			comic("monstress-1", "Monstress", 1),
		];

		expect(
			filterDownloadedComics(comics, "  SAGA   phang ").map(
				({ issueId }) => issueId,
			),
		).toEqual(["saga-10"]);
	});

	test("matches issue metadata and uses natural issue ordering", () => {
		const comics = [
			comic("saga-10", "Saga", 10, { seriesYear: "2012" }),
			comic("saga-2", "Saga", 2, { seriesYear: "2012" }),
			comic("saga-special", "Saga", "2A", { seriesYear: "2012" }),
		];

		expect(
			filterDownloadedComics(comics, "saga 2012").map(({ issueId }) => issueId),
		).toEqual(["saga-2", "saga-special", "saga-10"]);
	});

	test("returns no issues for blank or unmatched searches", () => {
		const comics = [comic("saga-1", "Saga", 1)];
		expect(filterDownloadedComics(comics, "  ")).toEqual([]);
		expect(filterDownloadedComics(comics, "Batman")).toEqual([]);
	});
});
