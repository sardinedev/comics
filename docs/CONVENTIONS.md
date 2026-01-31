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

Keep data-fetching helpers in `src/util/*`; call them from pages/routes. Don't scatter ad-hoc fetches across components.

## API routes

Return `new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })`.

Validate request bodies before use. See `src/pages/api/bulk-update.ts` for the pattern.

## Error handling

- Server-side: log the underlying error, return `4xx` for client errors, `5xx` for server errors.
- Never expose secrets (API keys) in logs or responses.



## Env vars

Declared in `src/env.d.ts`, accessed via `import.meta.env`.

Note: `src/util/elastic.ts` currently hard-codes `ELASTIC_URL`. Only change this if you're intentionally wiring it to env.
