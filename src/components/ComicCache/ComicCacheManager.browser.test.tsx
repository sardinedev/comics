import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("./comicCache.utils", () => ({
	deleteCachedIssue: vi.fn(),
	listCachedComics: vi.fn(),
}));

const { deleteCachedIssue, listCachedComics } = await import(
	"./comicCache.utils"
);
const { ComicCacheManager } = await import("./ComicCacheManager");

const mockedDeleteCachedIssue = vi.mocked(deleteCachedIssue);
const mockedListCachedComics = vi.mocked(listCachedComics);

afterEach(() => {
	vi.resetAllMocks();
});

describe("ComicCacheManager", () => {
	test("renders cached comics and deletes after confirmation", async () => {
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
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: true,
		});

		render(<ComicCacheManager />);

		await expect
			.element(page.getByRole("link", { name: "Saga #1" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText(/Cached 2026-05-03/))
			.toBeInTheDocument();

		await page.getByRole("button", { name: "Delete Saga #1" }).click();
		await page.getByRole("button", { name: "Confirm delete Saga #1" }).click();

		expect(mockedDeleteCachedIssue).toHaveBeenCalledWith("i1");
		await expect
			.element(page.getByText("No comics are cached in this browser."))
			.toBeInTheDocument();
	});

	test("renders and deletes a sidecar-less cached comic", async () => {
		mockedListCachedComics.mockResolvedValue([
			{
				issueId: "legacy",
				sizeBytes: 5,
				downloadUrl: "/api/comic/legacy/download",
				metadata: null,
			},
		]);
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: false,
		});

		render(<ComicCacheManager />);

		await expect
			.element(page.getByRole("link", { name: "Issue legacy" }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Cached archive")).toBeInTheDocument();

		await page.getByRole("button", { name: "Delete Issue legacy" }).click();
		await page
			.getByRole("button", { name: "Confirm delete Issue legacy" })
			.click();

		expect(mockedDeleteCachedIssue).toHaveBeenCalledWith("legacy");
		await expect
			.element(page.getByText("No comics are cached in this browser."))
			.toBeInTheDocument();
	});

	test("bulk deletes all selected cached comics after confirmation", async () => {
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
					sizeBytes: 1024,
					cachedAt: "2026-05-03T12:00:00.000Z",
					downloadUrl: "/api/comic/i1/download",
				},
			},
			{
				issueId: "i2",
				sizeBytes: 2048,
				downloadUrl: "/api/comic/i2/download",
				metadata: {
					version: 1,
					issueId: "i2",
					seriesName: "Saga",
					issueNumber: 2,
					sizeBytes: 2048,
					cachedAt: "2026-05-03T12:00:00.000Z",
					downloadUrl: "/api/comic/i2/download",
				},
			},
		]);
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: true,
		});

		render(<ComicCacheManager />);

		await expect
			.element(page.getByRole("link", { name: "Saga #1" }))
			.toBeInTheDocument();
		await page.getByLabelText("Select all").click();

		const deleteSelectedButton = page.getByRole("button", { name: "Delete 2" });
		await expect.element(deleteSelectedButton).toBeInTheDocument();
		await deleteSelectedButton.click();
		await page.getByRole("button", { name: "Confirm delete" }).click();

		expect(
			mockedDeleteCachedIssue.mock.calls.map(([issueId]) => issueId),
		).toEqual(["i1", "i2"]);
		await expect
			.element(page.getByText("No comics are cached in this browser."))
			.toBeInTheDocument();
	});
});
