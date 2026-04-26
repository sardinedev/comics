import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-preact";

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

function setupHappyPath(pageCount = 3) {
  mockedDownloadCbz.mockImplementation(async (_id, onProgress) => {
    onProgress(1);
    return new Uint8Array();
  });
  mockedExtractPages.mockResolvedValue(
    Array.from({ length: pageCount }, makeBlobUrl),
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
      await expect
        .element(page.getByText(/downloading/i))
        .toBeInTheDocument();
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
      await page.getByRole("button", { name: "Toggle controls" }).click();
      await expect.element(page.getByText("1 / 3")).toBeInTheDocument();

      await userEvent.keyboard("{ArrowRight}");

      await expect.element(page.getByText("2 / 3")).toBeInTheDocument();
    });
  });

  describe("navigation", () => {
    test("advances to the next page on tap zone click", async () => {
      setupHappyPath(3);

      render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
      await expect
        .element(page.getByRole("img", { name: "Page 1" }))
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Next page" }).click();

      await expect
        .element(page.getByRole("img", { name: "Page 2" }))
        .toBeInTheDocument();
    });

    test("returns to the previous page on tap zone click", async () => {
      setupHappyPath(3);

      render(<ComicReader issueId={ISSUE_ID} initialPage={2} />);
      await expect
        .element(page.getByRole("img", { name: "Page 2" }))
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Previous page" }).click();

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
  });

  describe("HUD", () => {
    test("shows the close button when controls are revealed", async () => {
      setupHappyPath(2);

      render(<ComicReader issueId={ISSUE_ID} initialPage={1} />);
      // HUD is hidden after load — tap to reveal it.
      await page.getByRole("button", { name: "Toggle controls" }).click();

      await expect
        .element(page.getByRole("button", { name: "Close reader" }))
        .toBeInTheDocument();
    });
  });

  describe("progress saving", () => {
    test("flushes progress via sendBeacon when the tab is hidden", async () => {
      setupHappyPath(3);
      const beacon = vi
        .spyOn(navigator, "sendBeacon")
        .mockReturnValue(true);

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
      const beacon = vi
        .spyOn(navigator, "sendBeacon")
        .mockReturnValue(true);

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
