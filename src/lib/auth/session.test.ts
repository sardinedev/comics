import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";

// Set env vars before the module is loaded so the module-level constants
// (SECRET, isHttps) are initialised with the test values.
process.env.AUTH_SESSION_SECRET = "test-secret-key";
process.env.PUBLIC_URL = "http://localhost:3000";

const session = await import("./session");

const SECRET = "test-secret-key";
const DID = "did:plc:abcdef123";

/** Build a valid encoded cookie value for a given DID. */
function makeValidCookieValue(did: string): string {
  const sig = createHmac("sha256", SECRET).update(did).digest("base64url");
  return encodeURIComponent(`${did}.${sig}`);
}

function makeRequest(cookieHeader: string): Request {
  return new Request("http://localhost", {
    headers: { cookie: cookieHeader },
  });
}

describe("getSessionDid", () => {
  it("returns null when the cookie header is absent", () => {
    const req = new Request("http://localhost");
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("returns null when the comics_session cookie is not present", () => {
    const req = makeRequest("other_cookie=value; another=123");
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("returns the DID for a correctly signed cookie", () => {
    const req = makeRequest(`comics_session=${makeValidCookieValue(DID)}`);
    expect(session.getSessionDid(req)).toBe(DID);
  });

  it("parses the session cookie when other cookies are present", () => {
    const req = makeRequest(`foo=bar; comics_session=${makeValidCookieValue(DID)}; baz=qux`);
    expect(session.getSessionDid(req)).toBe(DID);
  });

  it("returns null when the signature is forged with the wrong secret", () => {
    const sig = createHmac("sha256", "wrong-secret").update(DID).digest("base64url");
    const tampered = encodeURIComponent(`${DID}.${sig}`);
    const req = makeRequest(`comics_session=${tampered}`);
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("returns null when the cookie value has no dot separator", () => {
    const req = makeRequest(`comics_session=${encodeURIComponent(DID)}`);
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("returns null when the signature is the wrong length (timing-safe path)", () => {
    const req = makeRequest(`comics_session=${encodeURIComponent(`${DID}.short`)}`);
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("returns null when the cookie value is empty", () => {
    const req = makeRequest("comics_session=");
    expect(session.getSessionDid(req)).toBeNull();
  });

  it("round-trips correctly with setSessionCookie", () => {
    const setCookieHeader = session.setSessionCookie(DID);
    const cookieValue = setCookieHeader.match(/^comics_session=([^;]+)/)?.[1] ?? "";
    const req = makeRequest(`comics_session=${cookieValue}`);
    expect(session.getSessionDid(req)).toBe(DID);
  });
});

describe("setSessionCookie (HTTP)", () => {
  it("contains the cookie name", () => {
    expect(session.setSessionCookie(DID)).toMatch(/^comics_session=/);
  });

  it("embeds the DID in the cookie value", () => {
    const header = session.setSessionCookie(DID);
    const encoded = header.match(/^comics_session=([^;]+)/)?.[1] ?? "";
    const decoded = decodeURIComponent(encoded);
    expect(decoded.startsWith(`${DID}.`)).toBe(true);
  });

  it("includes HttpOnly", () => {
    expect(session.setSessionCookie(DID)).toContain("HttpOnly");
  });

  it("does NOT include Secure over HTTP", () => {
    expect(session.setSessionCookie(DID)).not.toContain("Secure");
  });

  it("includes SameSite=Lax", () => {
    expect(session.setSessionCookie(DID)).toContain("SameSite=Lax");
  });

  it("includes Max-Age for 2 years (63072000 seconds)", () => {
    expect(session.setSessionCookie(DID)).toContain("Max-Age=63072000");
  });

  it("includes Path=/", () => {
    expect(session.setSessionCookie(DID)).toContain("Path=/");
  });
});

describe("clearSessionCookie (HTTP)", () => {
  it("starts with the correct cookie name", () => {
    expect(session.clearSessionCookie()).toMatch(/^comics_session=/);
  });

  it("sets Max-Age=0 to expire immediately", () => {
    expect(session.clearSessionCookie()).toContain("Max-Age=0");
  });

  it("includes HttpOnly", () => {
    expect(session.clearSessionCookie()).toContain("HttpOnly");
  });

  it("does NOT include Secure over HTTP", () => {
    expect(session.clearSessionCookie()).not.toContain("Secure");
  });
});

describe("setSessionCookie and clearSessionCookie (HTTPS)", () => {
  let sessionHttps: typeof session;

  beforeAll(async () => {
    vi.resetModules();
    process.env.PUBLIC_URL = "https://example.com";
    sessionHttps = await import("./session");
  });

  afterAll(() => {
    process.env.PUBLIC_URL = "http://localhost:3000";
  });

  it("setSessionCookie includes the Secure flag", () => {
    expect(sessionHttps.setSessionCookie(DID)).toContain("; Secure");
  });

  it("clearSessionCookie includes the Secure flag", () => {
    expect(sessionHttps.clearSessionCookie()).toContain("; Secure");
  });
});
