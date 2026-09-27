/**
 * Set by the middleware on API responses when the request has no valid
 * session, so clients can tell it apart from a resource-level 401/403.
 */
export const AUTH_INVALID_HEADER = "x-comics-auth-invalid";
