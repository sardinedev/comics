
# Data Sources

This app pulls comic/series metadata from a mix of upstream APIs and stores (indexes) normalized issue documents in Elasticsearch for fast browsing.

## Code organization (where to look)

Each data source has a dedicated module in `src/util/` that exposes multiple functions to interact with it:

- `src/util/mylar.ts`: Mylar client + Mylar-specific API helpers
- `src/util/comicvine.ts`: Comic Vine client + Comic Vine-specific API helpers
- `src/util/elastic.ts`: Elasticsearch client + query/index helpers
- `src/util/sync.ts`: orchestration for syncing/seeding data between sources

Shared shapes live next to the clients:

- `src/util/comics.types.ts`: normalized `Issue` shape used throughout the app
- `src/util/mylar.types.ts`, `src/util/comicvine.types.ts`: upstream response typings

## Upstream sources

### Mylar (self-hosted)

**API docs**
- https://github.com/mylar3/mylar3/wiki/API-Documentation (API documentation is sparse, it's best to read the source)
- https://github.com/mylar3/mylar3/blob/master/mylar/api.py

**What it provides**

- Your library/collection: series list and series details (including issues).
- Issue cover URLs and release dates as tracked by Mylar.

**Configuration**

- API key: `MYLAR_API_KEY`
- Base URL is currently hard-coded in `src/util/mylar.ts`.

**Implementation**

- `src/util/mylar.ts`

### Comic Vine (public API)

**API docs**

- https://comicvine.gamespot.com/api/documentation

**What it provides**

- Extensive comic metadata: series details, issue details, character details, etc.

**Configuration**

- API key: `COMICVINE_API_KEY`
- Base URL is `https://comicvine.gamespot.com/api`.
- Requests include a `User-Agent` header.

**Implementation**

- `src/util/comicvine.ts`

**Images**

- Covers are loaded from Comic Vine image URLs.
- Astro is configured to allow remote images from `comicvine.gamespot.com` (see `astro.config.mjs`).

## Storage / index

### Elasticsearch (self-hosted)

**What it stores**

- A normalized `Issue` document (see `src/util/comics.types.ts`) used by pages and API routes.
- The index is currently hard-coded as `issues` in `src/util/elastic.ts`.

**Configuration**

- API key: `ELASTIC_API_KEY`
- Base URL is currently hard-coded in `src/util/elastic.ts`.

**Implementation**

- `src/util/elastic.ts`

> Note: `src/env.d.ts` declares `ELASTIC_URL` and `ELASTIC_INDEX`, but the current implementation uses hard-coded values. If you want these to be runtime-configurable, wire them through `import.meta.env`.

## Ingestion / sync flows

### Seed (full pass from Mylar → Elasticsearch)

Implemented in `seedElastic()` (`src/util/sync.ts`):

1. Creates an Elasticsearch index (best-effort; logs if it already exists).
2. Fetches all series from Mylar.
3. For each series, fetches series details (including issues).
4. Formats each Mylar issue into the app’s `Issue` shape.
5. Upserts each issue into Elasticsearch.

This is typically triggered via an Astro API route under `src/pages/api/` (file-based routing), but the exact URL can change as routes evolve.

### Sync (incremental create-only from Mylar → Elasticsearch)

Implemented in `syncMylarWithElastic()` (`src/util/sync.ts`):

- Same Mylar traversal as the seed, but uses create-only indexing (`elasticAddIssueWithoutUpdate`) and skips issues already present.

This is typically triggered via an Astro API route under `src/pages/api/` (file-based routing), but the exact URL can change as routes evolve.

## Keeping this doc accurate over time

When code moves, the most reliable way to re-ground this document is to start from `src/util/` (clients + sync) and follow imports.

