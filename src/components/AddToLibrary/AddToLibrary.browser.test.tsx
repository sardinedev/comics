import { $offline } from "@stores/offline.store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-preact";

vi.mock("./addToLibrary.utils", () => ({ addSeriesToLibrary: vi.fn() }));

const { addSeriesToLibrary } = await import("./addToLibrary.utils");
const { AddToLibrary } = await import("./AddToLibrary");
const mockedAdd = vi.mocked(addSeriesToLibrary);

beforeEach(() => {
	$offline.setKey("online", true);
	mockedAdd.mockResolvedValue("added");
});

afterEach(() => {
	vi.resetAllMocks();
	$offline.setKey("online", true);
});

describe("AddToLibrary", () => {
	test("adds the series", async () => {
		render(<AddToLibrary seriesId="series-1" />);

		await page.getByRole("button", { name: "Add to library" }).click();
		await expect
			.element(page.getByRole("button", { name: "Added to library" }))
			.toBeDisabled();
		await expect
			.element(page.getByText("Series added to your library."))
			.toBeInTheDocument();
		expect(mockedAdd).toHaveBeenCalledWith("series-1");
	});

	test("asks to sign in when the session expired", async () => {
		mockedAdd.mockResolvedValue("auth-required");
		render(<AddToLibrary seriesId="series-1" />);

		await page.getByRole("button", { name: "Add to library" }).click();
		await expect
			.element(page.getByText("Sign in again to add this series."))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Add to library" }))
			.toBeEnabled();
	});

	test("allows retry after a failure", async () => {
		mockedAdd.mockResolvedValue("failed");
		render(<AddToLibrary seriesId="series-1" />);

		await page.getByRole("button", { name: "Add to library" }).click();
		await expect
			.element(page.getByRole("button", { name: "Retry add" }))
			.toBeEnabled();
		await expect.element(page.getByRole("alert")).toBeInTheDocument();
	});

	test("waits for a connection instead of queueing offline", async () => {
		$offline.setKey("online", false);
		render(<AddToLibrary seriesId="series-1" />);

		await expect
			.element(page.getByRole("button", { name: "Available when online" }))
			.toBeDisabled();

		$offline.setKey("online", true);

		await expect
			.element(page.getByRole("button", { name: "Add to library" }))
			.toBeEnabled();
	});
});
