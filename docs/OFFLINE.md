# Offline mode

Offline mode combines an installable iOS PWA shell, cached app navigation,
downloaded comic bundles, local progress, and a replayable mutation outbox. A
user must complete one authenticated online launch before the app can work
offline.

## PWA installation and readiness

The app includes a web manifest, Apple touch icon, standalone display metadata,
and a root-scoped service worker. iOS does not expose a programmatic install
prompt, so the app supports installation through Safari's **Add to Home Screen**
action without showing its own prompt.

After registration, the app asks the active service worker to cache the required
root pages and their shell assets. The header reports **Preparing offline** until
the service worker verifies all required entries, then reports **Ready offline**.
It never infers readiness from registration alone. When the network is lost, the
same compact status region changes to **Offline** regardless of readiness.

The required root pages are:

- `/`
- `/new`
- `/series`
- `/search`
- `/cache`

## Document navigation policy

Same-origin document requests use network-first handling. This includes both
browser navigations and the HTML fetches made by Astro client transitions. A
successful response replaces the cached copy; a network failure falls back to
the most recently cached response for that exact URL, including its query
string.

Only successful `2xx`, non-redirected HTML responses can enter the document
cache. The service worker never caches API, login, logout, OAuth, client metadata,
redirect, non-HTML, or error responses. Shell assets under `/_astro`, `/icons`,
and `/pwa` use cache-first handling after their first validated response. The
warm-up follows JavaScript module imports and CSS asset references so a rendered
root page does not depend on an uncached transitive chunk.

Original `/covers/*` requests are network-first with read-only fallback to the
downloaded-cover cache. Merely viewing a cover does not add it to offline storage;
the comic download flow owns that decision.

Redirects to an authentication route and the explicit
`X-Comics-Auth-Invalid: true` response header are confirmed invalid-session
signals. They trigger the same full purge as logout. Generic `401` or `403`
responses do not, because they may describe a resource-level permission failure.

## Service-worker updates

A worker installed during an active reading session is left waiting. The client
records that an update is pending and promotes the waiting worker on a later app
launch, then reloads once under the new controller. Cache suffixes such as `v1`
are schema versions, not release versions; ordinary deployments update the
worker without discarding previously visited pages.

## Storage ownership

Offline data is split by purpose:

- IndexedDB stores small, structured records that must be queried: downloaded
  comic metadata, reading progress, queued mutations, and offline coordination
  state.
- Cache Storage stores response bodies and large binary data: CBZ archives,
  covers, cached documents, and the application shell.

The IndexedDB database is named `comics-offline`. Its schema is versioned and
upgraded in place; application code must use the repositories exported from
`src/lib/offline` rather than opening the database directly.

| Store | Key | Purpose |
| --- | --- | --- |
| `comics` | `issueId` | Searchable issue and series metadata plus archive/cover cache keys |
| `progress` | `issueId` | Local reading position and synchronization status |
| `outbox` | `id` | Idempotent server mutations queued for later replay |
| `offline-state` | `key` | Small state used by offline readiness and synchronization orchestration |

The outbox has a unique `dedupeKey`. Writing a newer mutation with the same key
replaces the older record, which prevents repeated progress updates for one issue
from growing the queue without bound. `queueProgressUpdate()` writes reading
progress and its corresponding mutation in one transaction. Add-to-library
actions use `library:{seriesId}` as their dedupe key and retain one stable
mutation id across retries.

## Schema migrations

`OFFLINE_DATABASE_VERSION` is the current database version. Every schema change
must increment it and add a forward-only migration to `migrateDatabase()`. An
upgrade must preserve records in existing stores. Browser tests cover a version
1 to version 2 upgrade; new versions should add an equivalent upgrade fixture.

Do not mutate or remove an old migration after it has shipped. Add a new version
step instead.

## Clearing offline data

`clearOfflineData()` is the single purge boundary for local offline data. It
closes and deletes the IndexedDB database, then removes every bucket listed in
`KNOWN_OFFLINE_CACHE_NAMES`. It deliberately does not import UI or authentication
code, so logout and confirmed session-invalid flows can call it directly.

The current owned cache buckets are:

- `comic-reader-v1`
- `comic-reader-v2`
- `comics-offline-assets-v1`
- `comics-offline-pages-v1`
- `comics-offline-covers-v1`

When a new offline cache is introduced, add its name to
`KNOWN_OFFLINE_CACHE_NAMES` in the same change. Unrelated origin caches are never
deleted.

## Security invariant

An explicit logout or a server-confirmed invalid session must erase downloaded
comics, cached pages, metadata, progress, and queued mutations. Being offline is
not evidence that a session is invalid; network failures must not trigger a
purge.

## Downloaded comic bundle schema

Downloaded comics use the `comic-reader-v2` Cache Storage bucket and the
IndexedDB `comics` store. A complete bundle consists of:

- a CBZ response at `/api/comic/{issueId}/download`;
- a version 2 JSON metadata sidecar at
  `/api/comic/{issueId}/cache-metadata`; and
- a matching searchable `OfflineComicRecord` in IndexedDB.

Cover bytes are best effort, live in `comics-offline-covers-v1`, and use the
same-origin `/offline/comics/{issueId}/cover` Cache Storage key while preserving
the original URL as source metadata. Metadata is valid only when it includes
non-empty issue and series identifiers, a series name, an issue number, archive
size and timestamp, cover state, and nullable previous/next references derived
from the server's canonical series ordering. `isIssueCached()` reports only
bundles with all three required records.

Bundle commits write optional cover bytes first, required metadata second, the
IndexedDB record third, and the archive last. If any required write fails, all
records written for that attempt are rolled back. A cover failure instead stores
`coverState: "pending"`, keeps the ThumbHash placeholder, and is retried on later
access. Deleting a bundle removes its archive, sidecar, IndexedDB record, and
cached cover.

On first access, entries from `comic-reader-v1` are copied forward. Version 1
sidecars with all required identity fields are upgraded to schema version 2 and
backfilled into IndexedDB. Incomplete legacy archives stay readable for backward
compatibility but are not advertised as complete offline bundles until current
metadata is supplied.

## Downloaded library and search

The Cached Comics page reads the canonical `OfflineComicRecord` entries from
IndexedDB rather than reconstructing its library from Cache Storage keys. It
orders records by series name and natural issue number, displays only covers
that have a downloaded cover cache key, and links each issue directly to its
normal `/comic/{issueId}/read` route. Deletion still goes through the bundle
deletion operation so the archive, sidecar, cover, and IndexedDB projection are
removed together.

The header search listens to both browser connectivity events and the PWA status
event. While offline it does not call the library or ComicVine APIs. Instead it
matches all query terms against downloaded issue and series metadata in
IndexedDB, labels the result set as downloaded-only, and links results directly
to the normal reader route. Online search keeps the existing library-first and
ComicVine result sections. Both modes retain keyboard result navigation and
explicit loading, empty, and error states.

## Offline reader

Reader navigations keep their normal `/comic/{issueId}/read` URL. If that
navigation fails, the service worker returns the cached generic reader shell
without redirecting the browser. The shell extracts the issue id from the
current URL and requires a matching v2 metadata sidecar, IndexedDB comic record,
and CBZ response before mounting the reader. Missing, partial, or corrupt saved
copies produce an error with a route back to `/cache` rather than a blank page.

The reader shell and its transitive JavaScript and CSS dependencies participate
in warm-up and readiness checks. **Ready offline** therefore means a normal
reader route can cold-launch after the PWA has been force-closed, provided that
the requested comic bundle is complete.

Reading position is stored immediately in the IndexedDB `progress` store using
one-based page numbers. Online reader pages compare the server and local progress
timestamps and restore the newest value; equal timestamps deterministically use
the server value. The generic offline shell has no server value, so it restores
valid local progress. Server replay is asynchronous; the reader does not depend
on replay to preserve its local position.

### Progress synchronization

`saveReadingProgress()` atomically writes the local position and a deduplicated
`progress` outbox mutation. Each mutation includes the current and total page,
an ISO client timestamp, and an idempotency id. An equal or older local update
does not replace a newer saved position.

Pending progress is replayed serially by the shared mutation engine when an
online app session starts, when the browser reports that it is back online, and
when the installed app returns to the foreground. This intentionally uses
foreground events rather than the Background Sync API. Successful updates mark
local progress synced. A server-stale response supplies its authoritative page
and timestamp, which replace the matching older local value before the mutation
is settled; malformed conflict responses are retried. Network and 5xx failures
stay pending with exponential retry metadata; permanent non-auth 4xx responses
are marked failed. A 401 or 403 stops replay and invokes the same complete
offline-data purge used for an invalid session.

The server accepts a progress update only when its normalized `updated_at` is
strictly newer than the issue's `progress_updated_at`. Equal timestamps are
deterministically stale, regardless of arrival order, so retries and multiple
devices cannot reverse a newer reading position.

### Add-to-library synchronization

Every add-to-library client uses `POST /api/library/add` with a JSON body
containing `seriesId` and, for queued actions, `mutationId`. The client writes
the outbox record before attempting an online request. Offline, network, and 5xx
outcomes remain visibly pending; permanent non-auth 4xx outcomes are marked
failed and can be retried. A 401 or 403 immediately invokes the full offline-data
purge and is never converted into another queued action. Logout remains a direct
security action and is not an outbox mutation.

The shared replay engine posts the same mutation id until the action succeeds.
Already-added responses count as success, and the API coalesces concurrent calls
and remembers a bounded set of completed ids within the server process. The
underlying Mylar operation is resource-idempotent by series id, so a replay after
a server restart may repeat the request but cannot intentionally create a second
series. The header badge reports the total pending and failed outbox actions; the
series control separately shows added, pending, and retry states.

Previous and next references come from the bundle's server-derived canonical
ordering. The final-page action opens only the exact next saved issue. When a
next reference exists but that bundle is unavailable, the reader shows
**Next issue isn’t downloaded** and never skips ahead to a later issue.
