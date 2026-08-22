import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("./offlineReader", () => ({
	OFFLINE_READER_ERROR:
		"This comic isn’t available offline or its saved copy is incomplete.",
	loadOfflineReaderBootstrap: vi.fn(),
}));

vi.mock("./ComicReader", () => ({
	ComicReader: ({ issueId }: { issueId: string }) => (
		<p>Reader ready for {issueId}</p>
	),
}));

const { loadOfflineReaderBootstrap } = await import("./offlineReader");
const { OfflineReaderShell } = await import("./OfflineReaderShell");
const mockedLoadBootstrap = vi.mocked(loadOfflineReaderBootstrap);

afterEach(() => vi.resetAllMocks());

describe("OfflineReaderShell", () => {
	test("shows an accessible loading state while validating storage", async () => {
		mockedLoadBootstrap.mockImplementation(() => new Promise(() => {}));
		render(<OfflineReaderShell />);

		await expect.element(page.getByRole("status")).toBeInTheDocument();
		await expect
			.element(page.getByText("Opening saved comic…"))
			.toBeInTheDocument();
	});

	test("mounts the reader after the complete bundle is validated", async () => {
		mockedLoadBootstrap.mockResolvedValue({
			issueId: "abc",
			initialPage: 3,
			hasUndownloadedNextIssue: false,
			offlineMode: true,
		});
		render(<OfflineReaderShell />);

		await expect
			.element(page.getByText("Reader ready for abc"))
			.toBeInTheDocument();
	});

	test("routes missing and corrupt bundles back to the saved library", async () => {
		mockedLoadBootstrap.mockRejectedValue(new Error("corrupt"));
		render(<OfflineReaderShell />);

		await expect.element(page.getByRole("alert")).toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: "Back to saved comics" }))
			.toHaveAttribute("href", "/cache");
	});
});
