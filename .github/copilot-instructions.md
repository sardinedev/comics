
# Copilot Agent Instructions (comics)

These instructions are for coding agents working in this repo. Optimize for small, safe changes that match existing patterns.

## Project overview

- Framework: Astro (server output) with Preact islands.
- Styling: Tailwind (via `@tailwindcss/vite`).
- Data layer: Elasticsearch index used as the app’s read model; Mylar + Comic Vine are upstream sources.
Use Preact islands only for interactive behavior; prefer Astro components for static content.

## Repo layout (where to look first)

- `src/pages/`: UI routes (Astro file-based routing).
- `src/pages/api/`: API routes (Astro file-based routing).
- `src/components/`: UI components (Astro + Preact where needed).
- `src/util/`: integrations + shared logic.
	- `src/util/mylar.ts`: Mylar client and helpers.
	- `src/util/comicvine.ts`: Comic Vine client and helpers.
	- `src/util/elastic.ts`: Elasticsearch client and query/index helpers.
	- `src/util/sync.ts`: sync/seed orchestration.
	- `src/util/comics.types.ts`: canonical `Issue` shape used throughout the app.
	- `src/util/*.types.ts`: upstream and internal type definitions.

Path aliases are configured in `tsconfig.json` (`@components/*`, `@layouts/*`, `@util/*`). Prefer using them.

## Commands

- Dev server: `npm run dev`
- Typecheck: `npm run type:check`
- Build: `npm run build`

Testing:

- Vitest is installed. If you add/modify tests, run `npx vitest run`.
- Tests are colocated in the format `*.test.ts`.

Node:

- This repo targets Node `22.12.0` (see `package.json`).

## Data sources (what/why)

- **Mylar** (self-hosted): source of truth for *your library* (series list, issues, download status, Mylar’s cover URLs).
- **Comic Vine** (public API): public metadata and covers; used for “new this week” and as a fallback when an issue isn’t in Elasticsearch.
- **Elasticsearch** (self-hosted): the app’s fast, denormalized read model for browsing/pagination/sorting.

If you touch data flows, keep the separation clear: upstream fetch → normalize into `Issue` → store/query in Elasticsearch.

## Configuration & environment

- Required secrets are typically:
	- `MYLAR_API_KEY`
	- `COMICVINE_API_KEY`
	- `ELASTIC_API_KEY`

Notes:

- Some base URLs/index names are currently hard-coded in `src/util/mylar.ts` and `src/util/elastic.ts`.
- `src/env.d.ts` declares `ELASTIC_URL` / `ELASTIC_INDEX` (and other vars). If you make configuration changes, prefer wiring through `import.meta.env` rather than adding more hard-coded values.

## Coding conventions

- Keep changes minimal and localized; avoid broad refactors unless explicitly requested.
- One logical change per PR; don't bundle unrelated fixes.
- Don’t add new UI themes/colors/shadows: reuse existing Tailwind utilities and component patterns.
- Prefer updating/adding functions in `src/util/*` rather than making ad-hoc fetches scattered across pages.
- When adding a new API route, follow existing `src/pages/api/*` patterns (return `Response`, JSON, proper status codes).

## Error handling & logging

- Follow existing patterns: log the underlying error (server-side) and return a reasonable status (`4xx` for client errors, `5xx` for server errors).
- Don’t leak secrets (API keys) to logs or to client-side code.

## Tests & mocks

- If you need fixtures for upstream data, prefer placing them under `src/util/mocks/`.
- Don’t add integration tests that require Mylar/Elasticsearch/Comic Vine unless explicitly asked.

## Documentation

- When updating docs in `docs/`, follow existing structure and tone.
- Prefer durable docs: point to stable modules/folders (e.g. `src/util/`, `src/pages/api/`) instead of listing URLs that may change.
- Keep docs short and action-oriented.

