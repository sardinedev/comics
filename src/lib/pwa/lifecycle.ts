export type PwaUiStatus = "offline" | "preparing" | "ready" | "unavailable";

export interface PwaUiStateInput {
	online: boolean;
	ready: boolean;
	supported: boolean;
}

/** Communicates connectivity and actual readiness rather than registration alone. */
export function derivePwaUiStatus({
	online,
	ready,
	supported,
}: PwaUiStateInput): PwaUiStatus {
	if (!online) return "offline";
	if (!supported) return "unavailable";
	return ready ? "ready" : "preparing";
}

/** Defers worker changes until a later launch to avoid interrupting reading. */
export function shouldActivateWaitingWorker({
	hasWaitingWorker,
	updateWasPendingAtLaunch,
}: {
	hasWaitingWorker: boolean;
	updateWasPendingAtLaunch: boolean;
}): boolean {
	return hasWaitingWorker && updateWasPendingAtLaunch;
}

export { isConfirmedAuthInvalidResponse } from "../offline/auth-response";
