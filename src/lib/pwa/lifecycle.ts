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

function isAuthPath(pathname: string): boolean {
	return (
		pathname === "/login" ||
		pathname.startsWith("/login/") ||
		pathname === "/logout" ||
		pathname.startsWith("/logout/") ||
		pathname === "/oauth" ||
		pathname.startsWith("/oauth/") ||
		pathname === "/api/auth" ||
		pathname.startsWith("/api/auth/")
	);
}

/**
 * Only explicit server signals and redirects to an authentication route count
 * as session invalidation. A generic 401/403 may describe a resource-level
 * permission failure and must not erase a user's downloaded comics.
 */
export function isConfirmedAuthInvalidResponse(
	response: Response,
	expectedOrigin?: string,
): boolean {
	if (response.headers.get("x-comics-auth-invalid") === "true") return true;
	if (!response.redirected) return false;
	try {
		const url = new URL(response.url);
		return (
			(!expectedOrigin || url.origin === expectedOrigin) &&
			isAuthPath(url.pathname)
		);
	} catch {
		return false;
	}
}
