import { AUTH_INVALID_HEADER } from "@lib/auth/headers";

/** The JSON 401 the middleware sends to API calls once the session is invalid. */
export function expiredSessionResponse(): Response {
	return new Response(JSON.stringify({ error: "Unauthorized" }), {
		status: 401,
		headers: {
			"Content-Type": "application/json",
			[AUTH_INVALID_HEADER]: "true",
		},
	});
}
