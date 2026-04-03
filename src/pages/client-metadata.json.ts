import type { APIRoute } from "astro";
import { env } from "@lib/env";

export const GET: APIRoute = () => {
  const PUBLIC_URL = env("PUBLIC_URL");
  if (!PUBLIC_URL) {
    return new Response("PUBLIC_URL not configured", { status: 500 });
  }

  const rawKey = env("ATPROTO_PRIVATE_KEY_JWK") ?? "{}";
  const parsedKey = JSON.parse(rawKey);
  if (!parsedKey.kid) parsedKey.kid = "key-1";
  const { d: _d, ...publicJwk } = parsedKey;

  const metadata = {
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
  };

  return new Response(JSON.stringify(metadata), {
    headers: { "Content-Type": "application/json" },
  });
};
