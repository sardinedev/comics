import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@components/ComicCache/comicCache.utils", () => ({
	getComicDownloadUrl: (issueId: string) =>
		`/api/comic/${encodeURIComponent(issueId)}/download`,
	openComicCache: vi.fn(),
	readCachedComicMetadata: vi.fn(),
}));

vi.mock("@lib/offline/database", () => ({
	offlineComics: { get: vi.fn() },
	offlineProgress: { get: vi.fn(), put: vi.fn() },
}));

import {
	openComicCache,
	readCachedComicMetadata,
} from "@components/ComicCache/comicCache.utils";
import { offlineComics, offlineProgress } from "@lib/offline/database";
import {
	loadOfflineReaderBootstrap,
	OFFLINE_READER_ERROR,
	parseComicReaderIssueId,
	resolveReaderStartPage,
} from "./offlineReader";

const cacheMatch = vi.fn();

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(openComicCache).mockResolvedValue({ match: cacheMatch } as never);
	vi.mocked(offlineProgress.get).mockResolvedValue(undefined);
});

describe("parseComicReaderIssueId", () => {
	it.each([
		["/comic/abc/read", "abc"],
		["/comic/an%20issue/read/", "an issue"],
		["/comic/abc", null],
		["/offline/reader", null],
		["/comic/%E0%A4%A/read", null],
	])("parses %s", (pathname, expected) => {
		expect(parseComicReaderIssueId(pathname)).toBe(expected);
	});
});

describe("reader progress", () => {
	it("prefers valid locally saved progress", async () => {
		vi.mocked(offlineProgress.get).mockResolvedValue({
			issueId: "abc",
			currentPage: 7,
			updatedAt: "2026-08-16T10:00:00.000Z",
			syncStatus: "pending",
		});
		await expect(resolveReaderStartPage("abc", 3)).resolves.toBe(7);
	});

	it("falls back to a valid server page", async () => {
		await expect(resolveReaderStartPage("abc", 3)).resolves.toBe(3);
		await expect(resolveReaderStartPage("abc", 0)).resolves.toBe(1);
	});

	it("prefers newer server progress and uses server on equal timestamps", async () => {
		vi.mocked(offlineProgress.get).mockResolvedValue({
			issueId: "abc",
			currentPage: 7,
			updatedAt: "2026-08-16T10:00:00.000Z",
			syncStatus: "synced",
		});

		await expect(
			resolveReaderStartPage("abc", 9, "2026-08-16T11:00:00.000Z"),
		).resolves.toBe(9);
		await expect(
			resolveReaderStartPage("abc", 8, "2026-08-16T10:00:00.000Z"),
		).resolves.toBe(8);
	});
});

describe("loadOfflineReaderBootstrap", () => {
	const currentMetadata = {
		version: 2 as const,
		issueId: "abc",
		seriesId: "series-1",
		seriesName: "Sardine Squad",
		issueNumber: 3,
		previousIssue: null,
		nextIssue: {
			issueId: "next",
			issueNumber: 4,
			issueName: "The Briny Bit",
		},
		sizeBytes: 120,
		cachedAt: "2026-08-16T09:00:00.000Z",
		downloadUrl: "/api/comic/abc/download",
		coverState: "unavailable" as const,
	};
	const currentRecord = {
		issueId: "abc",
		seriesId: "series-1",
		seriesName: "Sardine Squad",
		issueNumber: 3,
		archiveCacheKey: "/api/comic/abc/download",
		sizeBytes: 120,
		cachedAt: currentMetadata.cachedAt,
		updatedAt: currentMetadata.cachedAt,
	};

	it("loads a complete bundle and reports a canonical gap", async () => {
		vi.mocked(readCachedComicMetadata).mockImplementation(async (id) =>
			id === "abc" ? currentMetadata : null,
		);
		vi.mocked(offlineComics.get).mockImplementation(async (id) =>
			id === "abc" ? currentRecord : undefined,
		);
		cacheMatch.mockImplementation(async (url: string) =>
			url.includes("/abc/") ? new Response("archive") : undefined,
		);

		const result = await loadOfflineReaderBootstrap("/comic/abc/read");
		expect(result).toMatchObject({
			issueId: "abc",
			initialPage: 1,
			hasUndownloadedNextIssue: true,
			offlineMode: true,
		});
		expect(result.nextIssue).toBeUndefined();
	});

	it("offers only the exact next issue when its complete bundle exists", async () => {
		const nextMetadata = {
			...currentMetadata,
			issueId: "next",
			issueNumber: 4,
			nextIssue: null,
			cachedAt: "2026-08-16T09:30:00.000Z",
			downloadUrl: "/api/comic/next/download",
		};
		const nextRecord = {
			...currentRecord,
			issueId: "next",
			issueNumber: 4,
			archiveCacheKey: nextMetadata.downloadUrl,
			cachedAt: nextMetadata.cachedAt,
			updatedAt: nextMetadata.cachedAt,
		};
		vi.mocked(readCachedComicMetadata).mockImplementation(async (id) =>
			id === "abc" ? currentMetadata : nextMetadata,
		);
		vi.mocked(offlineComics.get).mockImplementation(async (id) =>
			id === "abc" ? currentRecord : nextRecord,
		);
		cacheMatch.mockResolvedValue(new Response("archive"));

		const result = await loadOfflineReaderBootstrap("/comic/abc/read");
		expect(result.hasUndownloadedNextIssue).toBe(false);
		expect(result.nextIssue).toEqual({
			id: "next",
			seriesName: "Sardine Squad",
			issueNumber: 4,
			issueName: "The Briny Bit",
		});
	});

	it("rejects a missing or inconsistent required bundle record", async () => {
		vi.mocked(readCachedComicMetadata).mockResolvedValue(currentMetadata);
		vi.mocked(offlineComics.get).mockResolvedValue(undefined);
		cacheMatch.mockResolvedValue(new Response("archive"));

		await expect(loadOfflineReaderBootstrap("/comic/abc/read")).rejects.toThrow(
			OFFLINE_READER_ERROR,
		);
	});
});
