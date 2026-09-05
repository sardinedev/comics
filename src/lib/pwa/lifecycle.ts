export type PwaUiStatus = "offline" | "preparing" | "ready" | "unavailable";

export interface PwaUiStateInput {
	online: boolean;
	ready: boolean;
	supported: boolean;
}

export function derivePwaUiStatus({
	online,
	ready,
	supported,
}: PwaUiStateInput): PwaUiStatus {
	if (!online) return "offline";
	if (!supported) return "unavailable";
	return ready ? "ready" : "preparing";
}

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
