import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("@lib/offline/library-sync", () => ({
	OUTBOX_STATUS_EVENT: "comics:outbox-status",
	getQueuedAddToLibrary: vi.fn(),
	requestAddToLibrary: vi.fn(),
}));

const { getQueuedAddToLibrary, requestAddToLibrary } = await import(
	"@lib/offline/library-sync"
);
const { AddToLibrary } = await import("./AddToLibrary");
const mockedGetQueued = vi.mocked(getQueuedAddToLibrary);
const mockedRequest = vi.mocked(requestAddToLibrary);

beforeEach(() => {
	mockedGetQueued.mockResolvedValue(undefined);
	mockedRequest.mockResolvedValue({ status: "added" });
});

afterEach(() => vi.resetAllMocks());

describe("AddToLibrary", () => {
	test("shows online success after the optimistic request", async () => {
		render(<AddToLibrary seriesId="series-1" />);

		await page.getByRole("button", { name: "Add to library" }).click();
		await expect
			.element(page.getByRole("button", { name: "Added to library" }))
			.toBeDisabled();
		await expect
			.element(page.getByText("Series added to your library."))
			.toBeInTheDocument();
		expect(mockedRequest).toHaveBeenCalledWith("series-1");
	});

	test("immediately exposes an obvious offline pending state", async () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		let resolveRequest!: (value: { status: "pending" }) => void;
		mockedRequest.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveRequest = resolve;
				}),
		);
		render(<AddToLibrary seriesId="series-1" />);

		await page.getByRole("button", { name: "Add to library" }).click();
		await expect
			.element(page.getByRole("button", { name: "Pending sync" }))
			.toBeDisabled();
		await expect
			.element(page.getByText("Will add when you’re back online."))
			.toBeInTheDocument();
		resolveRequest({ status: "pending" });
	});

	test("restores a failed queued action and allows retry", async () => {
		mockedGetQueued.mockResolvedValue({
			id: "library-1",
			dedupeKey: "library:series-1",
			kind: "add-to-library",
			payload: { seriesId: "series-1" },
			createdAt: "2026-08-16T10:00:00.000Z",
			updatedAt: "2026-08-16T10:00:00.000Z",
			attempts: 1,
			status: "failed",
		});
		render(<AddToLibrary seriesId="series-1" />);

		await expect
			.element(page.getByRole("button", { name: "Retry add" }))
			.toBeEnabled();
		await expect.element(page.getByRole("alert")).toBeInTheDocument();
	});
});
