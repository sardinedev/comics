import { AUTH_INVALID_HEADER } from "@lib/auth/headers";

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
	if (response.headers.get(AUTH_INVALID_HEADER) === "true") return true;
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

/** Thrown when the server confirms the session expired during a request. */
export class SessionExpiredError extends Error {
	constructor(message = "Your session has expired. Sign in again.") {
		super(message);
		this.name = "SessionExpiredError";
	}
}
