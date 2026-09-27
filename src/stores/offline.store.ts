import { isConfirmedAuthInvalidResponse } from "@lib/offline/auth-response";
import { atom } from "nanostores";

/**
 * Set when the server confirms the session is no longer valid. Downloads stay
 * readable; queued actions wait until the user signs in again. In-memory only,
 * so a full page load always retries sync.
 */
export const $syncAuthRequired = atom(false);

/**
 * Returns whether the response confirms the session expired, and sets
 * {@link $syncAuthRequired} if so. Any successful response clears it, since
 * the server accepted the session.
 */
export function flagIfSessionExpired(response: Response): boolean {
	const invalid = isConfirmedAuthInvalidResponse(
		response,
		globalThis.location?.origin,
	);
	if (invalid) $syncAuthRequired.set(true);
	else if (response.ok) $syncAuthRequired.set(false);
	return invalid;
}
