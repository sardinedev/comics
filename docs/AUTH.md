# Authentication

This app uses [AT Protocol OAuth 2.1](https://atproto.com/specs/oauth) to authenticate via a Bluesky account. It is a **single-user app** — only one DID (set via `AUTH_ALLOWED_DID`) is permitted through.

## How it works

The flow follows the OAuth 2.1 Authorization Code flow with PKCE and PAR (Pushed Authorization Requests), both mandatory in the ATProto spec.

```
Browser          App Server          Bluesky PDS
   |                  |                    |
   | POST /api/auth/authorize (handle)     |
   |----------------> |                    |
   |                  | client.authorize() |
   |                  |----PAR request---> |
   |                  | <-- request_uri -- |
   | <-- 302 to PDS auth UI ------------- |
   |                                       |
   | (user approves on Bluesky)            |
   |                                       |
   | GET /oauth/callback?code=&state=      |
   |----------------> |                    |
   |                  | client.callback()  |
   |                  |-- token exchange-->|
   |                  | <-- DID in `sub` --|
   | <-- 302 / + Set-Cookie (signed DID)   |
   |                                       |
   | GET / (with cookie)                   |
   |----------------> |                    |
   |           middleware verifies cookie  |
   |           checks DID == AUTH_ALLOWED_DID
   | <-- 200 app --|                       |
```

After the callback, the server stores only the **DID** in a signed cookie — no tokens in the browser. The ATProto session (tokens) lives in Elasticsearch, managed by `@atproto/oauth-client-node`.

## Architecture

```
src/
  lib/auth/
    client.ts     — NodeOAuthClient singleton (dev/prod config)
    session.ts    — HMAC-signed cookie (stores DID only)
    store.ts      — Elasticsearch adapter for OAuth state + sessions
  middleware.ts   — Route protection, injects locals.did
  pages/
    login.astro              — Login UI
    oauth/callback.astro     — OAuth callback handler
    client-metadata.json.ts  — Serves OAuth client metadata (prod only)
    api/auth/
      authorize.ts  — Starts OAuth flow
      logout.ts     — Revokes session, clears cookie
```

## Dev vs production

The ATProto spec has a special exception for `http://localhost` client IDs that removes the requirement to serve a public `client-metadata.json` endpoint. This means you can develop locally without a tunnel.

| | Development (`PUBLIC_URL` starts with `http://`) | Production (`https://`) |
|---|---|---|
| `client_id` | `http://localhost?redirect_uri=...` | `https://yourdomain.com/client-metadata.json` |
| Client type | Public (no signing key) | Confidential (`private_key_jwt`) |
| `token_endpoint_auth_method` | `none` | `private_key_jwt` |
| Metadata served at `/client-metadata.json` | Not used by PDS | Fetched by PDS on every auth |
| Signing key required | No | Yes (`ATPROTO_PRIVATE_KEY_JWK`) |

**The `isLocalDev` check in `client.ts` is `!PUBLIC_URL.startsWith("https://")`** — everything non-HTTPS is treated as local dev for the OAuth client configuration.

> Note: `AUTH_SESSION_SECRET` uses a stricter check — the fallback dev secret is only allowed when `PUBLIC_URL` is a genuine local URL (`http://localhost` or `http://127.0.0.1`). Any other URL, including non-HTTPS remote URLs, requires the secret to be explicitly set.

## Session cookie

Cookies store the DID as `{did}.{hmac_sig}` (base64url), signed with `AUTH_SESSION_SECRET` using HMAC-SHA256.

- No JWT, no third-party dependency — just Node's built-in `crypto`
- Signature prevents cookie tampering without the secret
- `timingSafeEqual` prevents timing attacks during verification
- `Secure` flag is set only when `PUBLIC_URL` starts with `https://`
- Format: `comics_session={encoded_did.sig}; HttpOnly; SameSite=Lax; ...`

## OAuth session storage (Elasticsearch)

`@atproto/oauth-client-node` needs pluggable stores for:
- **State** (`state:*`) — short-lived, created during authorize, deleted after callback
- **Session** (`session:*`) — long-lived, holds access/refresh tokens for the ATProto session

Both use `ElasticKeyedStore` backed by the `comics_oauth_store` index. Documents are prefixed (`state:key` vs `session:key`) to avoid collisions.

> Note: There is no automatic TTL on these documents. State entries are cleaned up by the OAuth client after a successful callback. If an auth flow is abandoned mid-way, orphaned state entries may accumulate. This is harmless for a single-user app but could be manually cleaned up with:
> ```
> POST comics_oauth_store/_delete_by_query
> {
>   "query": { "prefix": { "_id": "state:" } }
> }
> ```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | Yes | Full origin of the app, e.g. `https://comics.example.com` or `http://localhost:4321` |
| `AUTH_ALLOWED_DID` | Yes | The single DID allowed to log in, e.g. `did:plc:abc123` |
| `AUTH_SESSION_SECRET` | Yes (not required for `http://localhost` / `http://127.0.0.1`) | Random secret for HMAC cookie signing. Generate with: `openssl rand -hex 32` |
| `ATPROTO_PRIVATE_KEY_JWK` | Prod only | ES256 private key JWK. Generate with: `node -e "import('@atproto/jwk-jose').then(({JoseKey})=>JoseKey.generate(['ES256']).then(k=>console.log(JSON.stringify(k.privateJwk))))"` |

## Finding your DID

Go to `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=yourhandle.bsky.social` and copy the `did` field from the response.
