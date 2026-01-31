# Cover images

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
