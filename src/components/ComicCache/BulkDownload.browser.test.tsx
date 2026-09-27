import { SessionExpiredError } from "@lib/offline/auth-response";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("./comicCache.utils", () => ({
	isIssueCached: vi.fn(),
	downloadIssueToCache: vi.fn(),
}));

const { isIssueCached, downloadIssueToCache } = await import(
	"./comicCache.utils"
);
const { BulkDownload } = await import("./BulkDownload");

const mockedIsIssueCached = vi.mocked(isIssueCached);
const mockedDownloadIssueToCache = vi.mocked(downloadIssueToCache);

const ISSUES = [
	{ issueId: "i1", seriesName: "Saga", issueNumber: 1 },
	{ issueId: "i2", seriesName: "Saga", issueNumber: 2 },
];

async function openOptions() {
	const optionsButton = page.getByRole("button", { name: "Download options" });
	await expect.element(optionsButton).toBeInTheDocument();
	await optionsButton.click();
}

afterEach(() => {
	vi.resetAllMocks();
});

describe("BulkDownload", () => {
	test("keeps cache actions inside the options menu", async () => {
		mockedIsIssueCached.mockResolvedValue(false);

		render(<BulkDownload issues={ISSUES} downloadedIssues={ISSUES} />);

		await expect
			.element(page.getByRole("button", { name: "Download options" }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByRole("button", { name: /Bulk download unread issues/i }),
			)
			.not.toBeInTheDocument();

		await openOptions();

		await expect
			.element(page.getByRole("dialog", { name: "Download options" }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByRole("button", { name: /Bulk download unread issues/i }),
			)
			.toBeInTheDocument();
	});

	test("downloads only missing issues", async () => {
		mockedIsIssueCached.mockImplementation(async (issueId) => issueId === "i1");
		mockedDownloadIssueToCache.mockImplementation(
			async (_issueId, onProgress) => {
				onProgress(1);
				return new Uint8Array([1, 2, 3]);
			},
		);

		render(<BulkDownload issues={ISSUES} downloadedIssues={ISSUES} />);

		await openOptions();

		await expect
			.element(page.getByRole("group", { name: "1 of 2 downloaded" }))
			.toBeInTheDocument();

		const button = page.getByRole("button", {
			name: /Bulk download unread issues/i,
		});
		await expect.element(button).toBeInTheDocument();

		await button.click();

		await expect
			.element(page.getByRole("button", { name: /Unread issues downloaded/i }))
			.toBeInTheDocument();
		expect(mockedDownloadIssueToCache).toHaveBeenCalledTimes(1);
		expect(mockedDownloadIssueToCache.mock.calls[0]?.[0]).toBe("i2");
	});

	test("counts cached downloaded issues separately from unread eligibility", async () => {
		const readCachedIssue = {
			issueId: "read",
			seriesName: "Saga",
			issueNumber: 1,
		};
		const unreadMissingIssue = {
			issueId: "unread",
			seriesName: "Saga",
			issueNumber: 2,
		};

		mockedIsIssueCached.mockImplementation(
			async (issueId) => issueId === readCachedIssue.issueId,
		);
		mockedDownloadIssueToCache.mockImplementation(
			async (_issueId, onProgress) => {
				onProgress(1);
				return new Uint8Array([1, 2, 3]);
			},
		);

		render(
			<BulkDownload
				issues={[unreadMissingIssue]}
				downloadedIssues={[readCachedIssue, unreadMissingIssue]}
			/>,
		);

		await openOptions();

		await expect
			.element(page.getByRole("group", { name: "1 of 2 downloaded" }))
			.toBeInTheDocument();

		await page
			.getByRole("button", { name: /Bulk download unread issues/i })
			.click();

		await expect
			.element(page.getByRole("group", { name: "2 of 2 downloaded" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: /Unread issues downloaded/i }))
			.toBeInTheDocument();
		expect(mockedDownloadIssueToCache).toHaveBeenCalledTimes(1);
		expect(mockedDownloadIssueToCache.mock.calls[0]?.[0]).toBe(
			unreadMissingIssue.issueId,
		);
	});

	test("stops on a full quota and offers the current and remaining issues for retry", async () => {
		const issues = [
			...ISSUES,
			{ issueId: "i3", seriesName: "Saga", issueNumber: 3 },
		];
		mockedIsIssueCached.mockResolvedValue(false);
		mockedDownloadIssueToCache.mockImplementation(
			async (issueId, onProgress) => {
				if (issueId === "i2") {
					throw new DOMException("Storage full", "QuotaExceededError");
				}
				onProgress(1);
				return new Uint8Array([1, 2, 3]);
			},
		);

		render(<BulkDownload issues={issues} downloadedIssues={issues} />);

		await openOptions();
		await page
			.getByRole("button", { name: /Bulk download unread issues/i })
			.click();

		const alert = page.getByRole("alert");
		await expect.element(alert).toHaveTextContent(/Storage is full/);
		await expect
			.element(alert.getByRole("link", { name: "Cache page" }))
			.toHaveAttribute("href", "/cache");
		await expect
			.element(page.getByRole("button", { name: "Retry 2 issues" }))
			.toBeInTheDocument();
		expect(
			mockedDownloadIssueToCache.mock.calls.map(([issueId]) => issueId),
		).toEqual(["i1", "i2"]);
	});

	test("stops when the session expires and asks to sign in", async () => {
		const issues = [
			...ISSUES,
			{ issueId: "i3", seriesName: "Saga", issueNumber: 3 },
		];
		mockedIsIssueCached.mockResolvedValue(false);
		mockedDownloadIssueToCache.mockRejectedValue(new SessionExpiredError());

		render(<BulkDownload issues={issues} downloadedIssues={issues} />);

		await openOptions();
		await page
			.getByRole("button", { name: /Bulk download unread issues/i })
			.click();

		const alert = page.getByRole("alert");
		await expect.element(alert).toHaveTextContent(/session has expired/);
		await expect
			.element(alert.getByRole("link", { name: "Sign in again" }))
			.toHaveAttribute("href", "/login");
		await expect
			.element(page.getByRole("button", { name: "Retry 3 issues" }))
			.toBeInTheDocument();
		expect(mockedDownloadIssueToCache).toHaveBeenCalledOnce();
	});

	test("shows total downloaded count when no unread issues are eligible", async () => {
		mockedIsIssueCached.mockResolvedValue(true);

		render(
			<BulkDownload
				issues={[]}
				downloadedIssues={[
					{ issueId: "i1", seriesName: "Saga", issueNumber: 1 },
				]}
			/>,
		);

		await openOptions();

		await expect
			.element(page.getByRole("group", { name: "1 of 1 downloaded" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: /No unread issues/i }))
			.toBeInTheDocument();
		expect(mockedIsIssueCached).toHaveBeenCalledWith("i1");
	});
});
