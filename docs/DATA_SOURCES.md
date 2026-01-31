
# Data Sources

This app pulls comic/series metadata from a mix of upstream APIs and stores (indexes) normalized issue documents in Elasticsearch for fast browsing.

## Code organization (where to look)

Each data source has a dedicated module in `src/data/` that exposes multiple functions to interact with it:

- `src/data/mylar/mylar.ts`: Mylar client + Mylar-specific API helpers
- `src/data/comicvine/comicvine.ts`: Comic Vine client + Comic Vine-specific API helpers
- `src/data/elastic/elastic.ts`: Elasticsearch client + query/index helpers
- `src/util/covers.ts`: Cover image caching and serving helpers

Shared shapes live next to the clients:

- `src/util/comics.types.ts`: normalized `Issue` shape used throughout the app
- `src/data/mylar/mylar.types.ts`, `src/data/comicvine/comicvine.types.ts`: upstream response typings

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

- `src/data/mylar/mylar.ts`

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

- `src/data/comicvine/comicvine.ts`

**Images**

- Comic Vine's CDN (Cloudflare) blocks server-to-server requests with HTTP 403.
- Covers are self-hosted locally instead of hotlinking to Comic Vine.
- See [COVER_IMAGES.md](COVER_IMAGES.md) for details.

## Storage / index

### Elasticsearch (self-hosted)

**What it stores**

- A normalized `Issue` document (see `src/util/comics.types.ts`) used by pages and API routes.
- The index name is defined as `ISSUES_INDEX` in `src/data/elastic/models/issue.model.ts`.

**Configuration**

- API key: `ELASTIC_API_KEY`
- Base URL is currently hard-coded in `src/data/elastic/elastic.ts`.

**Implementation**

- `src/data/elastic/elastic.ts`

> Note: `src/env.d.ts` declares `ELASTIC_URL` and `ELASTIC_INDEX`, but the current implementation uses hard-coded values. The `ELASTIC_URL` is hard-coded in `src/data/elastic/elastic.ts` and the index name is defined in `src/data/elastic/models/issue.model.ts`. If you want these to be runtime-configurable, wire them through `import.meta.env`.


## Keeping this doc accurate over time

When code moves, the most reliable way to re-ground this document is to start from `src/data/` (clients) and `src/util/` (utilities) and follow imports.
