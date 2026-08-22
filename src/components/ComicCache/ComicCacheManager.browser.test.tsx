import type { OfflineComicRecord } from "@lib/offline/types";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("@lib/offline/database", () => ({
	isOfflineStorageSupported: vi.fn(() => true),
	offlineComics: { getAll: vi.fn() },
}));

vi.mock("./comicCache.utils", () => ({
	deleteCachedIssue: vi.fn(),
}));

const { isOfflineStorageSupported, offlineComics } = await import(
	"@lib/offline/database"
);
const { deleteCachedIssue } = await import("./comicCache.utils");
const { ComicCacheManager } = await import("./ComicCacheManager");

const mockedStorageSupported = vi.mocked(isOfflineStorageSupported);
const mockedGetAll = vi.mocked(offlineComics.getAll);
const mockedDeleteCachedIssue = vi.mocked(deleteCachedIssue);

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
		cachedAt: "2026-05-03T12:00:00.000Z",
		updatedAt: "2026-05-03T12:00:00.000Z",
		...overrides,
	};
}

afterEach(() => {
	vi.resetAllMocks();
	mockedStorageSupported.mockReturnValue(true);
});

describe("ComicCacheManager", () => {
	test("reads canonical offline records and links directly to the reader", async () => {
		mockedGetAll.mockResolvedValue([
			comic("i1", "Saga", 1, {
				issueName: "One",
				coverCacheKey: "/covers/saga-1.jpg",
			}),
		]);

		render(<ComicCacheManager />);

		const issueLink = page.getByRole("link", { name: "Saga #1" });
		await expect.element(issueLink).toBeInTheDocument();
		await expect.element(issueLink).toHaveAttribute("href", "/comic/i1/read");
		await expect
			.element(page.getByRole("img"))
			.toHaveAttribute("src", "/covers/saga-1.jpg");
		await expect
			.element(page.getByText(/Downloaded 2026-05-03/))
			.toBeInTheDocument();
		expect(mockedGetAll).toHaveBeenCalledOnce();
	});

	test("naturally orders issues and uses a placeholder without a cached cover", async () => {
		mockedGetAll.mockResolvedValue([
			comic("saga-10", "Saga", 10),
			comic("monstress-1", "Monstress", 1),
			comic("saga-2", "Saga", 2),
		]);

		render(<ComicCacheManager />);

		const links = page.getByRole("link");
		await expect.element(links.nth(0)).toHaveTextContent("Monstress #1");
		await expect.element(links.nth(1)).toHaveTextContent("Saga #2");
		await expect.element(links.nth(2)).toHaveTextContent("Saga #10");
		await expect.element(page.getByRole("img")).not.toBeInTheDocument();
	});

	test("deletes a downloaded issue through the bundle deletion utility", async () => {
		mockedGetAll.mockResolvedValue([comic("i1", "Saga", 1)]);
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: true,
			coverDeleted: false,
		});

		render(<ComicCacheManager />);

		await page.getByRole("button", { name: "Delete Saga #1" }).click();
		await page.getByRole("button", { name: "Confirm delete Saga #1" }).click();

		expect(mockedDeleteCachedIssue).toHaveBeenCalledWith("i1");
		await expect
			.element(page.getByText("No comics are downloaded in this browser."))
			.toBeInTheDocument();
	});

	test("reports deletion failures without removing the local row", async () => {
		mockedGetAll.mockResolvedValue([comic("i1", "Saga", 1)]);
		mockedDeleteCachedIssue.mockRejectedValue(new Error("storage failure"));

		render(<ComicCacheManager />);

		await page.getByRole("button", { name: "Delete Saga #1" }).click();
		await page.getByRole("button", { name: "Confirm delete Saga #1" }).click();

		await expect
			.element(
				page
					.getByRole("alert")
					.getByText("The downloaded comic could not be deleted."),
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: "Saga #1" }))
			.toBeInTheDocument();
	});

	test("bulk deletes all selected downloaded comics after confirmation", async () => {
		mockedGetAll.mockResolvedValue([
			comic("i1", "Saga", 1),
			comic("i2", "Saga", 2, { sizeBytes: 2048 }),
		]);
		mockedDeleteCachedIssue.mockResolvedValue({
			archiveDeleted: true,
			metadataDeleted: true,
			coverDeleted: false,
		});

		render(<ComicCacheManager />);

		await expect
			.element(page.getByRole("link", { name: "Saga #1" }))
			.toBeInTheDocument();
		await page.getByLabelText("Select all").click();
		await page.getByRole("button", { name: "Delete 2" }).click();
		await page.getByRole("button", { name: "Confirm delete" }).click();

		expect(
			mockedDeleteCachedIssue.mock.calls.map(([issueId]) => issueId),
		).toEqual(["i1", "i2"]);
		await expect
			.element(page.getByText("No comics are downloaded in this browser."))
			.toBeInTheDocument();
	});

	test("shows storage unsupported and read error states", async () => {
		mockedStorageSupported.mockReturnValue(false);
		const first = render(<ComicCacheManager />);
		await expect
			.element(page.getByText("Offline comic storage is unavailable"))
			.toBeInTheDocument();
		first.unmount();

		mockedStorageSupported.mockReturnValue(true);
		mockedGetAll.mockRejectedValue(new Error("IndexedDB failed"));
		render(<ComicCacheManager />);
		await expect
			.element(page.getByText("Failed to read downloaded comics."))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Retry" }))
			.toBeInTheDocument();
	});
});
