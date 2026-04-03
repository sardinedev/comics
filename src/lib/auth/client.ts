import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { JoseKey } from "@atproto/jwk-jose";
import { ElasticKeyedStore } from "./store";
import { env } from "@lib/env";

// Module-level singleton — initialised once per server process.
let _client: NodeOAuthClient | null = null;

/**
 * ATProto OAuth client singleton.
 *
 * The client is configured differently for local dev and production because
 * the ATProto spec has a special `http://localhost` client_id exception that
 * allows development without serving a public client-metadata.json endpoint.
 *
 * Dev  (PUBLIC_URL starts with http://)
 *   — Public client, no signing key, token_endpoint_auth_method: "none"
 *   — client_id is `http://localhost?redirect_uri=...` (virtual metadata, spec §localhost)
 *   — redirect_uri uses 127.0.0.1 (spec forbids the "localhost" hostname in redirect URIs)
 *
 * Prod (PUBLIC_URL starts with https://)
 *   — Confidential client, ES256 signing key, token_endpoint_auth_method: "private_key_jwt"
 *   — client_id points to the live /client-metadata.json endpoint
 *   — Requires ATPROTO_PRIVATE_KEY_JWK env var (see docs/AUTH.md for generation)
 *
 * See docs/AUTH.md for the full flow and environment variable reference.
 */
export async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_client) return _client;

  const PUBLIC_URL = env("PUBLIC_URL");
  if (!PUBLIC_URL) throw new Error("PUBLIC_URL env var is required for auth");

  const parsedUrl = new URL(PUBLIC_URL);
  const origin = parsedUrl.origin;
  const isHttps = parsedUrl.protocol === "https:";
  const isLoopback =
    parsedUrl.protocol === "http:" &&
    (parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "127.0.0.1" ||
      parsedUrl.hostname === "::1" ||
      parsedUrl.hostname === "[::1]");

  if (!isHttps && !isLoopback) {
    throw new Error(
      `PUBLIC_URL "${PUBLIC_URL}" is not a valid ATProto client origin. Use https:// for production or http://localhost / http://127.0.0.1 for local dev.`
    );
  }

  const isLocalDev = isLoopback;

  if (isLocalDev) {
    // Public client for localhost dev — no signing key required.
    // The Authorization Server generates virtual metadata for http://localhost client_ids.
    // Port numbers are ignored when matching redirect URIs; only the path must match.
    // See: https://atproto.com/specs/oauth#localhost-client-development
    _client = new NodeOAuthClient({
      clientMetadata: {
        client_id: `http://localhost?redirect_uri=${encodeURIComponent("http://127.0.0.1/oauth/callback")}&scope=atproto`,
        // Use 127.0.0.1 (not localhost) — required by RFC 8252 for loopback redirect URIs.
        // The port from PUBLIC_URL is included here so Bluesky redirects back to the right port.
        redirect_uris: [`${origin.replace("localhost", "127.0.0.1")}/oauth/callback`],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        scope: "atproto",
        dpop_bound_access_tokens: true,
        application_type: "native",
        token_endpoint_auth_method: "none",
      },
      stateStore: new ElasticKeyedStore("state"),
      sessionStore: new ElasticKeyedStore("session"),
    });

    return _client;
  }

  // Production: confidential client authenticated via private_key_jwt.
  // The PDS fetches /client-metadata.json to verify the public key before issuing tokens.
  const rawKey = env("ATPROTO_PRIVATE_KEY_JWK");
  if (!rawKey) {
    console.error("\n[auth] ATPROTO_PRIVATE_KEY_JWK is not set.");
    console.error(
      "[auth] Generate the ES256 private JWK locally and set it in your environment."
    );
    console.error(
      "[auth] Do not copy a private key from application logs. See docs/AUTH.md for the required format and setup steps.\n"
    );
    throw new Error("ATPROTO_PRIVATE_KEY_JWK not configured");
  }

  let parsedKey: Record<string, unknown>;
  try {
    parsedKey = JSON.parse(rawKey) as Record<string, unknown>;
  } catch {
    throw new Error("ATPROTO_PRIVATE_KEY_JWK is not valid JSON");
  }
  // `kid` (key ID) is required by the private_key_jwt auth method so the PDS
  // can match the assertion to the correct key in our JWKS.
  if (!parsedKey.kid) parsedKey.kid = "key-1";
  const privateKey = await JoseKey.fromImportable(parsedKey);
  // Strip the private scalar `d` to derive the public JWK for the JWKS endpoint.
  const { d: _d, ...publicJwk } = parsedKey;

  _client = new NodeOAuthClient({
    clientMetadata: {
      client_id: `${PUBLIC_URL}/client-metadata.json`,
      client_name: "Sardines Reading Comics",
      client_uri: PUBLIC_URL,
      redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "atproto",
      dpop_bound_access_tokens: true,
      application_type: "web",
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks: { keys: [publicJwk] },
    },
    keyset: [privateKey],
    stateStore: new ElasticKeyedStore("state"),
    sessionStore: new ElasticKeyedStore("session"),
  });

  return _client;
}
