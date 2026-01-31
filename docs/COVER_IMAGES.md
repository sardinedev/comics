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

```

### Implementation

- `src/util/covers.ts`: CBZ extraction and caching logiciesArt`)
- `src/pages/covers/[...path].ts`: Route handler for serving covers

### Dependencies

- `unzipper`: Used for CBZ extraction (CBZ files are ZIP archives)
