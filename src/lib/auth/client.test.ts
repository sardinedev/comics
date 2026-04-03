import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock module-level state — defined before vi.mock so the lazy factory
// can close over these references when it's invoked.
const NodeOAuthClientMock = vi.fn();

const JoseKeyMock = {
  generate: vi.fn().mockResolvedValue({
    privateJwk: { kty: "EC", crv: "P-256", kid: "generated-key" },
  }),
  fromImportable: vi.fn().mockResolvedValue({ privateKey: "mock-key" }),
};

vi.mock("@atproto/oauth-client-node", () => ({
  NodeOAuthClient: NodeOAuthClientMock,
}));

vi.mock("@atproto/jwk-jose", () => ({
  JoseKey: JoseKeyMock,
}));

vi.mock("./store", () => ({
  // Must be a regular function (not arrow) to be usable as a constructor.
  ElasticKeyedStore: vi.fn(function () { }),
}));

describe("getOAuthClient", () => {
  beforeEach(() => {
    // Clear the singleton and mock call history before each test.
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PUBLIC_URL;
    delete process.env.ATPROTO_PRIVATE_KEY_JWK;
  });

  it("throws when PUBLIC_URL is not set", async () => {
    const { getOAuthClient } = await import("./client");
    await expect(getOAuthClient()).rejects.toThrow(
      "PUBLIC_URL env var is required for auth"
    );
  });

  it("creates a public (dev) client for a localhost URL", async () => {
    process.env.PUBLIC_URL = "http://localhost:3000";
    const { getOAuthClient } = await import("./client");

    const client = await getOAuthClient();

    expect(client).toBeDefined();
    expect(NodeOAuthClientMock).toHaveBeenCalledOnce();
    expect(NodeOAuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMetadata: expect.objectContaining({
          token_endpoint_auth_method: "none",
          application_type: "native",
          scope: "atproto",
        }),
      })
    );
  });

  it("uses 127.0.0.1 (not localhost) in the redirect URI for local dev", async () => {
    process.env.PUBLIC_URL = "http://localhost:3000";
    const { getOAuthClient } = await import("./client");

    await getOAuthClient();

    const { clientMetadata } = NodeOAuthClientMock.mock.calls[0][0];
    expect(clientMetadata.redirect_uris[0]).toContain("127.0.0.1");
    expect(clientMetadata.redirect_uris[0]).not.toContain("localhost");
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    process.env.PUBLIC_URL = "http://localhost:3000";
    const { getOAuthClient } = await import("./client");

    const first = await getOAuthClient();
    const second = await getOAuthClient();

    expect(first).toBe(second);
    expect(NodeOAuthClientMock).toHaveBeenCalledOnce();
  });

  it("throws when ATPROTO_PRIVATE_KEY_JWK is missing in production", async () => {
    process.env.PUBLIC_URL = "https://example.com";
    vi.spyOn(console, "error").mockImplementation(() => { });

    const { getOAuthClient } = await import("./client");

    await expect(getOAuthClient()).rejects.toThrow(
      "ATPROTO_PRIVATE_KEY_JWK not configured"
    );
  });

  it("calls JoseKey.generate and logs instructions when JWK is missing in production", async () => {
    process.env.PUBLIC_URL = "https://example.com";
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });

    const { getOAuthClient } = await import("./client");
    await getOAuthClient().catch(() => { });

    expect(JoseKeyMock.generate).toHaveBeenCalledWith(["ES256"]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("creates a confidential (production) client when JWK is configured", async () => {
    process.env.PUBLIC_URL = "https://example.com";
    const privateJwk = {
      kty: "EC",
      crv: "P-256",
      d: "private-scalar",
      kid: "key-1",
    };
    process.env.ATPROTO_PRIVATE_KEY_JWK = JSON.stringify(privateJwk);

    const { getOAuthClient } = await import("./client");
    const client = await getOAuthClient();

    expect(client).toBeDefined();
    expect(NodeOAuthClientMock).toHaveBeenCalledOnce();
    expect(NodeOAuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMetadata: expect.objectContaining({
          token_endpoint_auth_method: "private_key_jwt",
          token_endpoint_auth_signing_alg: "ES256",
          application_type: "web",
        }),
      })
    );
  });

  it("strips the private key scalar (d) from the public JWKS in production", async () => {
    process.env.PUBLIC_URL = "https://example.com";
    const privateJwk = {
      kty: "EC",
      crv: "P-256",
      d: "private-scalar",
      kid: "key-1",
    };
    process.env.ATPROTO_PRIVATE_KEY_JWK = JSON.stringify(privateJwk);

    const { getOAuthClient } = await import("./client");
    await getOAuthClient();

    const { clientMetadata } = NodeOAuthClientMock.mock.calls[0][0];
    const publicKey = clientMetadata.jwks.keys[0];
    expect(publicKey).not.toHaveProperty("d");
    expect(publicKey.kty).toBe("EC");
    expect(publicKey.kid).toBe("key-1");
  });

  it("adds a default kid when the JWK does not include one", async () => {
    process.env.PUBLIC_URL = "https://example.com";
    const privateJwk = { kty: "EC", crv: "P-256", d: "private-scalar" }; // no kid
    process.env.ATPROTO_PRIVATE_KEY_JWK = JSON.stringify(privateJwk);

    const { getOAuthClient } = await import("./client");
    await getOAuthClient();

    expect(JoseKeyMock.fromImportable).toHaveBeenCalledWith(
      expect.objectContaining({ kid: "key-1" })
    );
  });
});
