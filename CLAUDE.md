# CLAUDE.md

## Project

Personal comics library browser. Astro 6 SSR (`output: "server"`) with Node adapter, deployed as a Docker container on a private VPS.

## Commands

```bash
npm run dev          # dev server at localhost:4321
npm test             # vitest run (once)
npm run type:check   # astro check
npm run build        # astro build + esbuild sync script
```

## Stack

- **Framework:** Astro 6 SSR + Node adapter
- **Interactive components:** Preact islands (`.tsx`) — only when interactivity is needed
- **Client state:** Nanostores (`src/stores/*.store.ts`); signals (`@preact/signals`) inside islands
- **Styling:** Tailwind 4 via `@tailwindcss/vite` — reuse existing utilities, no new custom colors/shadows
- **Data:** Elasticsearch (primary store), Mylar (library source), Comic Vine (metadata)
- **Auth:** ATProto OAuth 2.1 — see `docs/AUTH.md`
- **Tests:** Vitest, `environment: "node"`, colocated as `*.test.ts`

## Path aliases (tsconfig.json)

Always use these instead of relative imports crossing directory boundaries:

- `@components/*` → `src/components/*`
- `@layouts/*` → `src/layouts/*`
- `@data/*` → `src/data/*`
- `@lib/*` → `src/lib/*`
- `@util/*` → `src/util/*`

## Conventions

**Components:**
- `.astro` for static/server-rendered markup
- `.tsx` (Preact) for interactive islands only
- Complex components with assets go in a named subdirectory (`IssueGrid/IssueGrid.astro`); simple ones are flat in `src/components/`

**Data layer:**
- API clients in `src/data/` (Mylar, Comic Vine, Elasticsearch)
- Utilities in `src/util/`
- No ad-hoc fetches in components — call data helpers from pages/routes

**API routes:** Return `new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })`. Validate request bodies before use.

**Env vars:** Always access via the `env()` helper — works in both Astro SSR and Node scripts:
```ts
import { env } from "@lib/env";
const value = env("VAR_NAME");
```

**Error handling:** Log the underlying error server-side; return `4xx`/`5xx` accordingly. Never expose API keys.

**Auth:** All routes are protected by `src/middleware.ts` except paths listed in `PUBLIC_PATHS`/`PUBLIC_PREFIXES`. Authenticated DID is available via `locals.did`.

## Key docs

- `docs/CONVENTIONS.md` — coding standards
- `docs/AUTH.md` — ATProto OAuth flow, env vars, dev vs prod
- `docs/DATA_SOURCES.md` — Mylar, Comic Vine, Elasticsearch details
- `docs/TESTING.md` — Vitest setup, mock data location
