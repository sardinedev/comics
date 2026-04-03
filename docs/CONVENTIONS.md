# Coding conventions

Pull this doc in when working on API routes, integration logic, or component patterns.

## Stack

- Astro 5 SSR (`output: "server"`) with Node adapter.
- UI: Astro components for static content; Preact islands only for interactivity.
- Styling: Tailwind via `@tailwindcss/vite`. Reuse existing utilities—don't add new colors/shadows.
- Client state: Nanostores (`src/stores/*`).

## Path aliases

Configured in `tsconfig.json`. Prefer using them:

- `@util/*` → `src/util/*`
- `@components/*` → `src/components/*`
- `@layouts/*` → `src/layouts/*`

## Integration logic

Keep data-fetching helpers in `src/data/*` for API clients (Mylar, Comic Vine, Elasticsearch) and `src/util/*` for utilities. Call them from pages/routes. Don't scatter ad-hoc fetches across components.

## API routes

Return `new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })`.

Validate request bodies before use.

## Error handling

- Server-side: log the underlying error, return `4xx` for client errors, `5xx` for server errors.
- Never expose secrets (API keys) in logs or responses.

## Env vars

Declared in `src/env.d.ts`, accessed via `import.meta.env`.

In files that run outside of Astro's SSR context (OAuth client, session module), env vars must be read as:
```ts
(import.meta as any).env?.VAR_NAME ?? process.env.VAR_NAME
```
See `src/lib/auth/` for examples and `docs/AUTH.md` for why.

## Auth

See [docs/AUTH.md](./AUTH.md) for the full ATProto OAuth flow, dev/prod differences, session cookie design, and environment variable reference.

Note: `src/data/elastic/elastic.ts` currently hard-codes `ELASTIC_URL`. Only change this if you're intentionally wiring it to env.
