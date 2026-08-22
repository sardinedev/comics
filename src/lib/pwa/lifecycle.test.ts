import { describe, expect, it } from "vitest";
import {
	derivePwaUiStatus,
	isConfirmedAuthInvalidResponse,
	shouldActivateWaitingWorker,
} from "./lifecycle";

describe("derivePwaUiStatus", () => {
	it("always makes a lost connection obvious", () => {
		expect(
			derivePwaUiStatus({ online: false, ready: false, supported: false }),
		).toBe("offline");
	});

	it("does not claim readiness before the warm-up succeeds", () => {
		expect(
			derivePwaUiStatus({ online: true, ready: false, supported: true }),
		).toBe("preparing");
	});

	it("reports a verified ready shell", () => {
		expect(
			derivePwaUiStatus({ online: true, ready: true, supported: true }),
		).toBe("ready");
	});

	it("reports unsupported browsers without pretending to prepare", () => {
		expect(
			derivePwaUiStatus({ online: true, ready: false, supported: false }),
		).toBe("unavailable");
	});
});

describe("shouldActivateWaitingWorker", () => {
	it("activates only an update that was already pending at launch", () => {
		expect(
			shouldActivateWaitingWorker({
				hasWaitingWorker: true,
				updateWasPendingAtLaunch: true,
			}),
		).toBe(true);
	});

	it("does not interrupt the session where an update first arrives", () => {
		expect(
			shouldActivateWaitingWorker({
				hasWaitingWorker: true,
				updateWasPendingAtLaunch: false,
			}),
		).toBe(false);
	});
});

describe("isConfirmedAuthInvalidResponse", () => {
	it("recognises the explicit server invalidation header", () => {
		const response = new Response(null, {
			headers: { "X-Comics-Auth-Invalid": "true" },
			status: 401,
		});
		expect(isConfirmedAuthInvalidResponse(response)).toBe(true);
	});

	it("does not purge for an unrelated unauthorized response", () => {
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
