import { describe, expect, test } from "vitest";
import { renderPendingActionCountElements } from "./library-sync";

describe("pending action count", () => {
	test("renders pending and failed totals accessibly", () => {
		const root = document.createElement("div");
		root.innerHTML = "<span data-outbox-pending-count hidden></span>";

		renderPendingActionCountElements({ pending: 2, failed: 1, total: 3 }, root);

		const count = root.querySelector<HTMLElement>(
			"[data-outbox-pending-count]",
		);
		expect(count?.hidden).toBe(false);
		expect(count?.textContent).toBe("3");
		expect(count?.dataset.state).toBe("failed");
		expect(count?.getAttribute("aria-label")).toBe(
			"2 pending actions, 1 failed actions",
		);
	});

	test("hides when the outbox is empty", () => {
		const root = document.createElement("div");
		root.innerHTML = "<span data-outbox-pending-count>1</span>";
		renderPendingActionCountElements({ pending: 0, failed: 0, total: 0 }, root);
		expect(
			root.querySelector<HTMLElement>("[data-outbox-pending-count]")?.hidden,
		).toBe(true);
	});
});
