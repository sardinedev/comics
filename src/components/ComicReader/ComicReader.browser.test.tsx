import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-preact";
import { DOUBLE_TAP_MAX_DELAY_MS } from "./comicReader.gestures";

// Mock the utils module so component tests don't depend on real network or
// zip decoding. Each test installs its own implementations below.
vi.mock("./comicReader.utils", () => ({
	downloadCbz: vi.fn(),
	extractPages: vi.fn(),
}));

// Re-import after vi.mock so we get the mocked versions.
const { downloadCbz, extractPages } = await import("./comicReader.utils");
const { ComicReader } = await import("./ComicReader");

const mockedDownloadCbz = vi.mocked(downloadCbz);
const mockedExtractPages = vi.mocked(extractPages);

const ISSUE_ID = "abc";
const PROGRESS_URL = `/api/comic/${ISSUE_ID}/progress`;

// A 1×1 transparent PNG — big enough that the browser will happily set it as
// an <img> src without complaining.
const TINY_PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Track blob URLs created by the harness so we can revoke them between tests.
// (The component only revokes the URLs it tracks itself.)
const createdBlobUrls: string[] = [];

function makeBlobUrl(): string {
	const bytes = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(",")[1]), (c) =>
		c.charCodeAt(0),
	);
	const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
	createdBlobUrls.push(url);
	return url;
}

function makeSvgBlobUrl(width: number, height: number): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#111827"/><path d="M ${width / 2} 0 V ${height}" stroke="#f59e0b" stroke-width="8"/></svg>`;
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	createdBlobUrls.push(url);
	return url;
}

function setupHappyPath(
	pageCount = 3,
	pageFactory: () => string = makeBlobUrl,
) {
	mockedDownloadCbz.mockImplementation(async (_id, onProgress) => {
		onProgress(1);
		return new Uint8Array();
	});
	mockedExtractPages.mockResolvedValue(
		Array.from({ length: pageCount }, pageFactory),
	);
}

function getReaderViewport(): HTMLDivElement {
	const viewport = document.querySelector<HTMLDivElement>(
		"[data-reader-scroll-viewport]",
	);
	if (!viewport) throw new Error("Reader scroll viewport was not rendered");
	return viewport;
}

function getGestureLayer(): HTMLDivElement {
	return getReaderViewport();
}

function getVisiblePageImage(pageNumber: number): HTMLImageElement {
	const image = document.querySelector<HTMLImageElement>(
		`img[data-current-page="true"][alt="Page ${pageNumber}"]`,
	);
	if (!image) throw new Error(`Page ${pageNumber} image was not rendered`);
	return image;
}

function clickReaderAt(x: number, y: number) {
	getReaderViewport().dispatchEvent(
		new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: x,
			clientY: y,
		}),
	);
}

async function mouseTapReaderAt(x: number, y: number) {
	clickReaderAt(x, y);
	await waitPastTapDelay();
}

async function scrollSnapToPage(pageNumber: number) {
	const viewport = getReaderViewport();
	const pageItem = document.querySelector<HTMLElement>(
		`[data-reader-page="${pageNumber}"]`,
	);
	if (!pageItem) throw new Error(`Page item ${pageNumber} was not rendered`);

	viewport.scrollLeft =
		pageItem.offsetLeft ||
		(viewport.clientWidth || window.innerWidth) * (pageNumber - 1);
	viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

	await vi.waitFor(() => {
		expect(getVisiblePageImage(pageNumber).dataset.currentPage).toBe("true");
	});
}

function fireTouchPointer(
	target: HTMLElement,
	type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
	x: number,
	y: number,
) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			clientX: x,
			clientY: y,
			button: 0,
		}),
	);
}

function touchSwipe(fromX: number, fromY: number, toX: number, toY: number) {
	const layer = getGestureLayer();
	fireTouchPointer(layer, "pointerdown", fromX, fromY);
	fireTouchPointer(layer, "pointermove", toX, toY);
	fireTouchPointer(layer, "pointerup", toX, toY);
}

async function touchDoubleTap(x: number, y: number) {
	const layer = getGestureLayer();
	fireTouchPointer(layer, "pointerdown", x, y);
	fireTouchPointer(layer, "pointerup", x, y);
	fireTouchPointer(layer, "pointerdown", x, y);
	fireTouchPointer(layer, "pointerup", x, y);
}

async function waitPastTapDelay() {
	await new Promise((resolve) =>
		window.setTimeout(resolve, DOUBLE_TAP_MAX_DELAY_MS + 30),
	);
}

/**
 * Fire a synthetic visibilitychange that reports "hidden" without leaking the
 * property override into later tests — vi.spyOn is auto-restored.
 */
function triggerTabHidden() {
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
	// Default: sendBeacon succeeds. Individual tests can replace this spy.
	vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
});

afterEach(() => {
	// resetAllMocks clears both vi.fn()s from vi.mock() and restores spies.
	vi.resetAllMocks();
	for (const url of createdBlobUrls) URL.revokeObjectURL(url);
	createdBlobUrls.length = 0;
});

describe("ComicReader", () => {
	describe("loading & error states", () => {
		test("shows a loading indicator before pages are ready", async () => {
			// downloadCbz never resolves — we want to assert the loading state.
			mockedDownloadCbz.mockImplementation(() => new Promise(() => {}));

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);

			await expect.element(page.getByRole("status")).toBeInTheDocument();
			await expect.element(page.getByText(/downloading/i)).toBeInTheDocument();
		});

		test("renders an error state when download fails", async () => {
			mockedDownloadCbz.mockRejectedValueOnce(
				new Error("Download failed (500)"),
			);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);

			await expect.element(page.getByRole("alert")).toBeInTheDocument();
			await expect
				.element(page.getByText("Download failed (500)"))
				.toBeInTheDocument();
		});
	});

	describe("rendering", () => {
		test("renders the first page once the comic is ready", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);

			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});

		test("clamps initialPage above the page count", async () => {
			setupHappyPath(2);

			render(<ComicReader issueId={ISSUE_ID} initialPage={99} />);

			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();
		});

		test("page counter reflects current page after navigation", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			// Reveal HUD so the counter is visible, then advance.
			await mouseTapReaderAt(window.innerWidth / 2, 100);
			await expect.element(page.getByText("1 / 3")).toBeInTheDocument();

			await userEvent.keyboard("{ArrowRight}");

			await expect.element(page.getByText("2 / 3")).toBeInTheDocument();
		});
	});

	describe("navigation", () => {
		test("advances to the next page on right tap zone click", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await mouseTapReaderAt(window.innerWidth - 20, 100);

			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();
		});

		test("returns to the previous page on left tap zone click", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={2} />);
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			await mouseTapReaderAt(20, 100);

			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});

		test("ArrowRight advances and ArrowLeft retreats", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await userEvent.keyboard("{ArrowRight}");
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			await userEvent.keyboard("{ArrowLeft}");
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});

		test("does not advance past the last page", async () => {
			setupHappyPath(2);

			render(<ComicReader issueId={ISSUE_ID} initialPage={2} />);
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			await userEvent.keyboard("{ArrowRight}");
			// Still on page 2.
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();
		});

		test("does not retreat past the first page", async () => {
			setupHappyPath(2);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await userEvent.keyboard("{ArrowLeft}");
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});

		test("syncs the current page from horizontal scroll-snap movement", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await scrollSnapToPage(2);

			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			await scrollSnapToPage(1);

			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});

		test("does not treat synthetic unzoomed touch drags as JS page turns", async () => {
			setupHappyPath(3);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			touchSwipe(160, 100, 190, 104);
			touchSwipe(160, 100, 260, 230);

			await waitPastTapDelay();
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
		});
	});

	describe("zoom gestures", () => {
		test("double-tap zooms into and out of the tapped half of a wide page", async () => {
			setupHappyPath(1, () => makeSvgBlobUrl(2000, 1000));

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
			await vi.waitFor(() =>
				expect(getVisiblePageImage(1).naturalWidth).toBeGreaterThan(1),
			);

			await touchDoubleTap(120, 100);

			await vi.waitFor(() => {
				expect(getVisiblePageImage(1).dataset.zoomRegion).toBe("left");
			});

			await touchDoubleTap(120, 100);

			await vi.waitFor(() => {
				expect(
					getVisiblePageImage(1).getAttribute("data-zoom-region"),
				).toBeNull();
			});
		});

		test("pans while zoomed and only changes page from a pan edge", async () => {
			setupHappyPath(2, () => makeSvgBlobUrl(2000, 1000));

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();
			await vi.waitFor(() =>
				expect(getVisiblePageImage(1).naturalWidth).toBeGreaterThan(1),
			);

			await touchDoubleTap(120, 100);
			await vi.waitFor(() => {
				expect(getVisiblePageImage(1).dataset.zoomRegion).toBe("left");
			});

			touchSwipe(320, 100, 120, 105);

			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await touchDoubleTap(window.innerWidth - 120, 100);
			await vi.waitFor(() => {
				expect(getVisiblePageImage(1).dataset.zoomRegion).toBe("right");
			});

			touchSwipe(320, 100, 120, 105);

			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();
		});
	});

	describe("HUD", () => {
		test("shows the close button when controls are revealed", async () => {
			setupHappyPath(2);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			// HUD is hidden after load — tap to reveal it.
			await mouseTapReaderAt(window.innerWidth / 2, 100);

			await expect
				.element(page.getByRole("button", { name: "Close reader" }))
				.toBeInTheDocument();
		});
	});

	describe("next issue CTA", () => {
		test("shows a read-next action on the final page when a downloaded next issue is provided", async () => {
			setupHappyPath(2);

			render(
				<ComicReader
					issueId={ISSUE_ID}
					initialPage={1}
					nextIssue={{
						id: "next-issue",
						seriesName: "Sardine Squad",
						issueNumber: 4,
						issueName: "The Briny Bit",
					}}
				/>,
			);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			expect(
				document.querySelector('a[href="/comic/next-issue/read"]'),
			).toBeNull();

			await userEvent.keyboard("{ArrowRight}");

			await expect
				.element(page.getByRole("link", { name: "Read next" }))
				.toBeInTheDocument();
			expect(
				document.querySelector('a[href="/comic/next-issue/read"]'),
			).not.toBeNull();
			await expect
				.element(page.getByText("Sardine Squad #4"))
				.toBeInTheDocument();
		});

		test("hides the final-page read-next action when no next issue is provided", async () => {
			setupHappyPath(1);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			expect(document.querySelector('a[href$="/read"]')).toBeNull();
		});
	});

	describe("progress saving", () => {
		test("flushes progress via sendBeacon when the tab is hidden", async () => {
			setupHappyPath(3);
			const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			// Move to page 2 so there's actually something to flush.
			await userEvent.keyboard("{ArrowRight}");
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			triggerTabHidden();

			expect(beacon).toHaveBeenCalledWith(PROGRESS_URL, expect.any(Blob));
			// Decode the body and assert the API contract.
			const [, blob] = beacon.mock.calls.at(-1)!;
			const body = JSON.parse(await (blob as Blob).text());
			expect(body).toEqual({ current_page: 2, total_pages: 3 });
		});

		test("does not re-send progress for an unchanged page", async () => {
			setupHappyPath(3);
			const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);

			render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
			await expect
				.element(page.getByRole("img", { name: "Page 1" }))
				.toBeInTheDocument();

			await userEvent.keyboard("{ArrowRight}");
			await expect
				.element(page.getByRole("img", { name: "Page 2" }))
				.toBeInTheDocument();

			triggerTabHidden();
			const callsAfterFirstFlush = beacon.mock.calls.length;
			expect(callsAfterFirstFlush).toBeGreaterThanOrEqual(1);

			// A second flush with the same page should be deduped.
			triggerTabHidden();
			expect(beacon.mock.calls.length).toBe(callsAfterFirstFlush);
		});
	});
});
