/**
 * Session cookie management.
 *
 * After a successful OAuth callback the server issues an HMAC-signed cookie
 * containing only the user's DID. No tokens are stored in the browser.
 *
 * Cookie format: `{did}.{base64url(HMAC-SHA256(did, AUTH_SESSION_SECRET))}`
 *
 * Verification uses `timingSafeEqual` to prevent timing-based forgery attacks.
 * The `Secure` flag is omitted in local dev (http://) so the browser accepts
 * the cookie over plain HTTP on 127.0.0.1.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@lib/env";

// Secure flag is only safe to set over HTTPS. In local dev (http://localhost)
// the browser would silently drop a Secure cookie, breaking the auth flow.
const publicUrl = env("PUBLIC_URL") ?? "";
const isHttps = publicUrl.startsWith("https://");

function isLocalDevUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === "http:" &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

const _rawSecret = env("AUTH_SESSION_SECRET");
if (!_rawSecret && !isLocalDevUrl(publicUrl)) {
  throw new Error(
    "AUTH_SESSION_SECRET must be set. Only local dev (http://localhost, http://127.0.0.1) may omit it."
  );
}
const SECRET = _rawSecret ?? "dev-secret-please-change-me";

const COOKIE_NAME = "comics_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

/** Returns `{value}.{base64url_signature}`. */
function sign(value: string): string {
  const sig = createHmac("sha256", SECRET).update(value).digest("base64url");
  return `${value}.${sig}`;
}

/**
 * Verifies the signature on a cookie value.
 * Splits on the last `.` to extract value + sig, then compares
 * with a freshly computed HMAC using constant-time comparison.
 * Returns the value on success, null on any failure.
 */
function verify(cookie: string): string | null {
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const value = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = createHmac("sha256", SECRET)
    .update(value)
    .digest("base64url");
  try {
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return value;
  } catch {
    // timingSafeEqual throws if the two buffers have different lengths,
    // which happens when the cookie has been truncated or corrupted.
  }
  return null;
}

/**
 * Extracts and verifies the session cookie from a request.
 * Returns the DID stored in the cookie, or null if absent/invalid.
 */
export function getSessionDid(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) {
      try {
        const value = decodeURIComponent(rest.join("="));
        return verify(value);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Returns the `Set-Cookie` header string for a new session. */
export function setSessionCookie(did: string): string {
  const value = encodeURIComponent(sign(did));
  const secure = isHttps ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

/** Returns a `Set-Cookie` header that immediately expires the session cookie. */
export function clearSessionCookie(): string {
  const secure = isHttps ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}
