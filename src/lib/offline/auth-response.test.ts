import { describe, expect, it } from "vitest";
import { isConfirmedAuthInvalidResponse } from "./auth-response";

describe("isConfirmedAuthInvalidResponse", () => {
	it("recognises the explicit server invalidation header", () => {
		const response = new Response(null, {
			headers: { "X-Comics-Auth-Invalid": "true" },
			status: 401,
		});
		expect(isConfirmedAuthInvalidResponse(response)).toBe(true);
	});

	it("ignores an unrelated unauthorized response", () => {
		expect(
			isConfirmedAuthInvalidResponse(new Response(null, { status: 401 })),
		).toBe(false);
	});

	it("recognises a followed redirect to login", () => {
		const response = new Response(null, { status: 200 });
		Object.defineProperties(response, {
			redirected: { value: true },
			url: { value: "https://comics.example/login" },
		});
		expect(
			isConfirmedAuthInvalidResponse(response, "https://comics.example"),
		).toBe(true);
	});

	it("does not trust a login redirect on another origin", () => {
		const response = new Response(null, { status: 200 });
		Object.defineProperties(response, {
			redirected: { value: true },
			url: { value: "https://accounts.example/login" },
		});
		expect(
			isConfirmedAuthInvalidResponse(response, "https://comics.example"),
		).toBe(false);
	});
});
