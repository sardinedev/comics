import type { OfflineStatusSource } from "@lib/offline/search";
import type { OfflineComicRecord } from "@lib/offline/types";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("@lib/offline/search", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lib/offline/search")>();
	return { ...actual, searchDownloadedComics: vi.fn() };
});

const { searchDownloadedComics } = await import("@lib/offline/search");
const { SearchBar } = await import("./SearchBar");
const mockedSearchDownloadedComics = vi.mocked(searchDownloadedComics);

function comic(
	issueId: string,
	issueNumber: number,
	overrides: Partial<OfflineComicRecord> = {},
): OfflineComicRecord {
	return {
		issueId,
		seriesId: "series-saga",
		seriesName: "Saga",
		issueNumber,
		archiveCacheKey: `/api/comic/${issueId}/download`,
		sizeBytes: 1024,
		cachedAt: "2026-08-16T10:00:00.000Z",
		updatedAt: "2026-08-16T10:00:00.000Z",
		...overrides,
	};
}

function connectivity(initiallyOffline: boolean): {
	source: OfflineStatusSource;
	setOffline: (offline: boolean) => void;
} {
	let offline = initiallyOffline;
	const listeners = new Set<(offline: boolean) => void>();
	return {
		source: {
			isOffline: () => offline,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		setOffline: (nextOffline) => {
			offline = nextOffline;
			for (const listener of listeners) listener(offline);
		},
	};
}

function openSearch() {
	window.dispatchEvent(new CustomEvent("open-search"));
}

afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllGlobals();
});

describe("SearchBar", () => {
	test("searches only downloaded metadata while offline", async () => {
		const networkFetch = vi.fn();
		vi.stubGlobal("fetch", networkFetch);
		mockedSearchDownloadedComics.mockResolvedValue([
			comic("issue/1", 1, {
				issueName: "Chapter One",
				seriesYear: "2012",
				coverCacheKey: "/covers/saga-1.jpg",
			}),
		]);
		const status = connectivity(true);
		render(<SearchBar connectivity={status.source} />);
		openSearch();

		await expect
			.element(page.getByText("Offline · Searching downloaded comics only"))
			.toBeInTheDocument();
		await page
			.getByRole("searchbox", { name: "Search downloaded comics" })
			.fill("Saga");

		const result = page.getByRole("link", { name: /Saga #1/ });
		await expect.element(result).toBeInTheDocument();
		await expect
			.element(result)
			.toHaveAttribute("href", "/comic/issue%2F1/read");
		await expect.element(result).toHaveTextContent("Downloaded");
		await expect
			.element(result.getByRole("img"))
			.toHaveAttribute("src", "/covers/saga-1.jpg");
		expect(mockedSearchDownloadedComics).toHaveBeenCalledWith("Saga");
		expect(networkFetch).not.toHaveBeenCalled();
	});

	test("shows an offline empty state", async () => {
		const status = connectivity(true);
		mockedSearchDownloadedComics.mockResolvedValue([]);
		render(<SearchBar connectivity={status.source} />);
		openSearch();
		const searchbox = page.getByRole("searchbox", {
			name: "Search downloaded comics",
		});
		await searchbox.fill("Batman");
		await expect
			.element(page.getByText(/No downloaded comics for/))
			.toBeInTheDocument();
	});

	test("shows local search errors", async () => {
		const status = connectivity(true);
		mockedSearchDownloadedComics.mockRejectedValue(
			new Error("IndexedDB failed"),
		);
		render(<SearchBar connectivity={status.source} />);
		openSearch();
		await page
			.getByRole("searchbox", { name: "Search downloaded comics" })
			.fill("Saga");
		await expect
			.element(
				page
					.getByRole("alert")
					.getByText("Downloaded comics could not be searched."),
			)
			.toBeInTheDocument();
	});

	test("preserves both online search sources and keyboard highlighting", async () => {
		const networkFetch = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith("/api/search/comicvine")) {
				return Promise.resolve(
					new Response(
						JSON.stringify([
							{
								id: 200,
								name: "Saga Deluxe",
								start_year: "2013",
							},
						]),
						{ status: 200 },
					),
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify([
						{
							series_id: "100",
							series_name: "Saga",
							series_year: "2012",
						},
					]),
					{ status: 200 },
				),
			);
		});
		vi.stubGlobal("fetch", networkFetch);
		const status = connectivity(false);
		render(<SearchBar connectivity={status.source} />);
		openSearch();

		const searchbox = page.getByRole("searchbox", { name: "Search series" });
		await searchbox.fill("Saga");
		const libraryResult = page.getByRole("link", { name: /^Saga 2012/ });
		const comicVineResult = page.getByRole("link", {
			name: /^Saga Deluxe 2013/,
		});
		await expect.element(libraryResult).toBeInTheDocument();
		await expect.element(comicVineResult).toBeInTheDocument();
		await expect.element(libraryResult).toHaveAttribute("href", "/series/100");
		await searchbox.click();
		await userEvent.keyboard("{ArrowDown}");
		await expect.element(libraryResult).toHaveClass(/bg-slate-800/);
		await userEvent.keyboard("{ArrowDown}");
		await expect.element(comicVineResult).toHaveClass(/bg-slate-800/);
		expect(networkFetch).toHaveBeenCalledTimes(2);
		expect(mockedSearchDownloadedComics).not.toHaveBeenCalled();
	});

	test("switches an open dialog to local search when PWA status goes offline", async () => {
		const networkFetch = vi.fn(() =>
			Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
		);
		vi.stubGlobal("fetch", networkFetch);
		mockedSearchDownloadedComics.mockResolvedValue([comic("issue-2", 2)]);
		const status = connectivity(false);
		render(<SearchBar connectivity={status.source} />);
		openSearch();
		await page.getByRole("searchbox", { name: "Search series" }).fill("Saga");
		status.setOffline(true);

		await expect
			.element(
				page.getByRole("searchbox", { name: "Search downloaded comics" }),
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: /Saga #2/ }))
			.toBeInTheDocument();
		expect(mockedSearchDownloadedComics).toHaveBeenCalledWith("Saga");
	});

	test("shows an explicit online error when both remote sources fail", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.reject(new Error("offline"))),
		);
		const status = connectivity(false);
		render(<SearchBar connectivity={status.source} />);
		openSearch();
		await page.getByRole("searchbox", { name: "Search series" }).fill("Saga");

		await expect
			.element(
				page
					.getByRole("alert")
					.getByText("Online search is unavailable. Try again when connected."),
			)
			.toBeInTheDocument();
	});
});
