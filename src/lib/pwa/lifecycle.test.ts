import { describe, expect, it } from "vitest";
import { derivePwaUiStatus, shouldActivateWaitingWorker } from "./lifecycle";

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
