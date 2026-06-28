import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("@components/ComicCache/comicCache.utils", () => ({
	deleteCachedIssue: vi.fn(),
	getOfflineComicUrl: (issueId: string) => `/offline/comic/${issueId}`,
	getOfflineReaderUrl: (issueId: string) => `/offline/read/${issueId}`,
	listCachedComics: vi.fn(),
	readCachedComicMetadata: vi.fn(),
}));

vi.mock("@components/ComicReader/ComicReader", () => ({
	ComicReader: ({
		issueId,
		backHref,
	}: {
		issueId: string;
		backHref: string;
	}) => (
		<div role="application" data-back-href={backHref}>
			Reader {issueId}
		</div>
	),
}));

const { deleteCachedIssue, listCachedComics, readCachedComicMetadata } =
	await import("@components/ComicCache/comicCache.utils");
const { OfflineLibrary } = await import("./OfflineLibrary");

const mockedDeleteCachedIssue = vi.mocked(deleteCachedIssue);
const mockedListCachedComics = vi.mocked(listCachedComics);
const mockedReadCachedComicMetadata = vi.mocked(readCachedComicMetadata);

function pushPath(path: string) {
	window.history.pushState({}, "", path);
}

afterEach(() => {
	vi.resetAllMocks();
	pushPath("/offline");
});

describe("OfflineLibrary", () => {
	test("renders cached comics and opens the reader view", async () => {
		mockedListCachedComics.mockResolvedValue([
			{
				issueId: "i1",
				sizeBytes: 1024,
				downloadUrl: "/api/comic/i1/download",
				metadata: {
					version: 1,
					issueId: "i1",
					seriesName: "Saga",
					issueNumber: 1,
					issueName: "One",
					sizeBytes: 1024,
					cachedAt: "2026-05-03T12:00:00.000Z",
					downloadUrl: "/api/comic/i1/download",
				},
			},
		]);

		render(<OfflineLibrary />);

		await expect.element(page.getByText("Saga #1")).toBeInTheDocument();
		await page.getByRole("button", { name: "Read" }).click();

		await expect
			.element(page.getByRole("application"))
			.toHaveTextContent("Reader i1");
	});

	test("renders detail view from the URL and deletes the cached issue", async () => {
		pushPath("/offline/comic/i1");
		mockedListCachedComics.mockResolvedValue([]);
		mockedReadCachedComicMetadata.mockResolvedValue({
			version: 1,
			issueId: "i1",
			seriesName: "Saga",
			issueNumber: 1,
			issueDescription: "A cached description.",
			sizeBytes: 1024,
			cachedAt: "2026-05-03T12:00:00.000Z",
			downloadUrl: "/api/comic/i1/download",
		});
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: true,
		});

		render(<OfflineLibrary />);

		await expect.element(page.getByText("Saga #1")).toBeInTheDocument();
		await expect
			.element(page.getByText("A cached description."))
			.toBeInTheDocument();

		await page.getByRole("button", { name: "Delete" }).click();

		expect(mockedDeleteCachedIssue).toHaveBeenCalledWith("i1");
		await expect
			.element(page.getByText("No comics are cached in this browser."))
			.toBeInTheDocument();
	});
});
