
# Data Sources

This app pulls comic/series metadata from a mix of upstream APIs and stores (indexes) normalized issue documents in Elasticsearch for fast browsing.

## Code organization (where to look)

Each data source has a dedicated module in `src/util/` that exposes multiple functions to interact with it:

- `src/util/mylar.ts`: Mylar client + Mylar-specific API helpers
- `src/util/comicvine.ts`: Comic Vine client + Comic Vine-specific API helpers
- `src/util/elastic.ts`: Elasticsearch client + query/index helpers
- `src/util/covers.ts`: Cover image caching and serving helpers
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
- Issue download status (`Downloaded`, `Wanted`, `Skipped`).
- Downloaded comic files (CBZ) via `downloadIssue` API.
- Series cover art via `getArt` API.

**Configuration**

- API key: `MYLAR_API_KEY`
- Base URL: `MYLAR_URL` (defaults to `http://192.168.50.190:8090`)

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

- Comic Vine's CDN (Cloudflare) blocks server-to-server requests with HTTP 403.
- Covers are self-hosted locally instead of hotlinking to Comic Vine.
- See "Cover images" section below for details.

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

## Cover images

Cover images use a hybrid approach based on whether an issue has been downloaded:

### Downloaded issues (extracted from CBZ)

For issues with `status: "Downloaded"`:
1. The first image file in the CBZ archive (alphabetically sorted by filename) is treated as the cover.
2. That image is extracted from the CBZ via Mylar's `downloadIssue` API and cached under `COVERS_DIR` using a stable filename (e.g. `{issueId}.jpg`).
3. Elasticsearch stores this cover filename (relative path like `{issueId}.jpg`) in the normalized `Issue` document (not the original CBZ location).
4. The `/covers/[...path]` route reads from `COVERS_DIR` and serves the cached image for downloaded issues.
5. UI components build cover `src` URLs pointing at `/covers/...` when an issue is marked as downloaded.
6. Astro's `<Image>` component handles resizing and format conversion on-demand.

### Non-downloaded issues (ComicVine direct)
For issues with `status: "Wanted"` or `"Skipped"`:
1. Elasticsearch stores the original ComicVine URL.
2. Browser fetches directly from ComicVine (CDN allows browser requests).
3. No server-side caching (since we can't reliably fetch from ComicVine server-side).

### Configuration

- `COVERS_DIR`: Local directory for cached covers (default: `data/covers`)

### Backfill

To populate covers for downloaded issues, the backfill endpoint only targets issues that:

1. Have `status: "Downloaded"`, and
2. Still have a remote cover URL (`issue_cover` starts with `http`).

This means each successful run shrinks the remaining work over time.

If a cover file already exists in `data/covers/` and `force=false`, the backfill will only update Elasticsearch to point `issue_cover` at `/covers/{id}.jpg` (no re-download).
```bash
# Check status (shows downloaded vs non-downloaded breakdown)
curl http://localhost:4321/api/covers/backfill

# Run backfill (processes up to 100 downloaded issues)
curl -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	'http://localhost:4321/api/covers/backfill?limit=100'

# Force re-download
curl -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	'http://localhost:4321/api/covers/backfill?limit=100&force=true'

# Dry-run backfill (preview which issues would be processed without downloading or updating covers)
curl -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	'http://localhost:4321/api/covers/backfill?limit=100&dry=true'
```

### Implementation

- `src/util/covers.ts`: CBZ extraction and caching logic
- `src/util/mylar.ts`: Mylar API (`mylarDownloadIssue`, `mylarGetSeriesArt`)
- `src/pages/covers/[...path].ts`: Route handler for serving covers
- `src/pages/api/covers/backfill.ts`: Backfill API endpoint

### Dependencies

- `unzipper`: Used for CBZ extraction (CBZ files are ZIP archives)

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

