import { afterEach, describe, expect, it } from "vitest";
import { renderPwaStatusElements } from "./status";

afterEach(() => {
	document.body.replaceChildren();
});

describe("renderPwaStatusElements", () => {
	it("reveals and labels every status region in the current page", () => {
		const first = document.createElement("div");
		const second = document.createElement("div");
		first.dataset.pwaStatus = "";
		second.dataset.pwaStatus = "";
		first.hidden = true;
		second.hidden = true;
		document.body.append(first, second);

		renderPwaStatusElements("offline");

		for (const element of [first, second]) {
			expect(element.hidden).toBe(false);
			expect(element.dataset.status).toBe("offline");
		}
	});

	it("can update a page restored by client-side navigation", () => {
		const status = document.createElement("div");
		status.dataset.pwaStatus = "";
		document.body.append(status);

		renderPwaStatusElements("ready");
		renderPwaStatusElements("offline");

		expect(status.dataset.status).toBe("offline");
	});
});
