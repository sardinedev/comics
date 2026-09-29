import { isConfirmedAuthInvalidResponse } from "@lib/offline/auth-response";
import { computed, map } from "nanostores";

export type OfflineState = {
	/** Browser connectivity, updated by the PWA client's online/offline listeners. */
	online: boolean;
	/** Whether the service worker reports the offline shell as cached. */
	shellReady: boolean;
	/** Local reading progress waiting to reach the server. */
	pendingProgress: number;
	/** Local reading progress the server rejected; discard it on /cache. */
	failedProgress: number;
	/**
	 * Set when the server confirms the session is no longer valid. Downloads
	 * stay readable; pending progress waits until the user signs in again.
	 * In-memory only, so a full page load always retries sync.
	 */
	authRequired: boolean;
};

export const $offline = map<OfflineState>({
	online: globalThis.navigator?.onLine ?? true,
	shellReady: false,
	pendingProgress: 0,
	failedProgress: 0,
	authRequired: false,
});

/** Only notifies when connectivity changes, not on every sync count update. */
export const $isOffline = computed($offline, (state) => !state.online);

/**
 * Returns whether the response confirms the session expired, and sets
 * `authRequired` if so. Any successful response clears it, since the server
 * accepted the session.
 */
export function flagIfSessionExpired(response: Response): boolean {
	const invalid = isConfirmedAuthInvalidResponse(
		response,
		globalThis.location?.origin,
	);
	if (invalid) $offline.setKey("authRequired", true);
	else if (response.ok) $offline.setKey("authRequired", false);
	return invalid;
}
