
# Data Sources

This app pulls comic/series metadata from a mix of upstream APIs and stores (indexes) normalized issue documents in Elasticsearch for fast browsing.

## Code organization (where to look)

Each data source has a dedicated module in `src/data/` that exposes multiple functions to interact with it:

- `src/data/mylar/mylar.ts`: Mylar client + Mylar-specific API helpers
- `src/data/comicvine/comicvine.ts`: Comic Vine client + Comic Vine-specific API helpers
- `src/data/elastic/elastic.ts`: Elasticsearch client + query/index helpers
- `src/util/covers.ts`: Cover image caching and serving helpers

Shared shapes live next to the clients:

- `src/data/comics.types.ts`: normalized `Issue` shape used throughout the app
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

**Rate limiting**
- Support 200 requests per resource, per hour.

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

### Offline bundle metadata

The series page asks Elasticsearch for the complete server-sorted issue list
when it prepares downloadable browser bundles. Downloaded issues receive
references to their immediate previous and next entries in that result—even if
an adjacent issue has not been downloaded. This preserves canonical series
ordering and lets the offline reader report a real download gap instead of
silently skipping it.

The browser metadata sidecar contains stable issue and series identifiers,
display names, issue number/date, cover information, adjacency references,
archive size, and cache timestamp. The matching IndexedDB record is the
searchable projection used by offline library and search views. Both are local
projections of Elasticsearch data, not additional server-side sources of truth.

### Reading progress conflict resolution

Elasticsearch stores `current_page`, `progress_updated_at`, and the last applied
`progress_mutation_id` on each issue. The progress API requires the client to
send `current_page`, `total_pages`, an ISO `updated_at`, and a mutation id. Its
scripted update applies only timestamps strictly newer than the stored value;
equal or older timestamps return a successful stale result without changing the
document. Reading-state transition timestamps use that same client timestamp so
the page and its derived `reading`/`read` state remain one atomic update.

> Note: `src/env.d.ts` declares `ELASTIC_URL` and `ELASTIC_INDEX`, but the current implementation uses hard-coded values. The `ELASTIC_URL` is hard-coded in `src/data/elastic/elastic.ts` and the index name is defined in `src/data/elastic/models/issue.model.ts`. If you want these to be runtime-configurable, wire them through `import.meta.env`.


## Keeping this doc accurate over time

When code moves, the most reliable way to re-ground this document is to start from `src/data/` and follow imports.
