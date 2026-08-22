# Testing

This project uses Vitest for Node unit tests and Playwright-backed Chromium and
WebKit browser tests.

## Running tests

```bash
# Run all tests
npm test

# Run only Node tests
npx vitest run --project node

# Run only browser tests
npx vitest run --project browser

# Add WebKit to the browser project (release gate; requires local WebKit)
PWA_WEBKIT=1 npx vitest run --project browser

# Run tests in watch mode
npx vitest

# Run tests with coverage
npx vitest run --coverage
```

## Test organization

- **Test runner**: Vitest, with Chromium supplied by Playwright for routine
  browser tests and opt-in WebKit coverage for the iOS-oriented release gate
- **Node tests**: Colocate as `*.test.ts` next to the module under test
- **Browser tests**: Colocate as `*.browser.test.ts` or
  `*.browser.test.tsx`; use these for IndexedDB, Cache Storage, rendering, and
  other browser-only APIs
- **Mocks**: Upstream fixtures go in `src/util/mocks/`

## Writing tests

Tests should be placed next to the code they're testing with a `.test.ts` extension. For example:

```
src/util/formatter.ts
src/util/formatter.test.ts
```

Code that relies on real browser APIs should use a `.browser.test.ts` suffix.
The offline storage tests intentionally exercise the browser's IndexedDB and
Cache Storage implementations instead of replacing them with in-memory mocks.
Every such test must delete the databases and cache buckets it creates in setup
and teardown so tests remain isolated.

Chromium remains the default so `npm test` works after an ordinary dependency
install. WebKit is deliberately opt-in because Playwright browser binaries are
installed separately and may not exist on every developer or CI machine. To run
the iOS-oriented browser gate:

```bash
npx playwright install webkit
PWA_WEBKIT=1 npx vitest run --project browser
```

This runs the browser suite in both Chromium and WebKit. It is engine coverage,
not a substitute for an installed PWA on physical iOS: desktop WebKit does not
reproduce iOS storage eviction, home-screen installation, or process suspension.

### Mock data

Mock data for external APIs (Mylar, Comic Vine) should be placed in `src/util/mocks/` for reuse across tests.

Existing mocks:
- `comicvineIssues.mock.ts`: Sample Comic Vine issue data
- `comicvineVolume.mock.ts`: Sample Comic Vine volume data

## Offline storage checks

When changing the IndexedDB schema or an owned cache name, run:

```bash
npx vitest run --project browser src/lib/offline
npm run type:check:tsc
```

Schema changes require an upgrade test that starts from the previous database
version and proves existing records survive. Purge tests must verify both that
all owned storage is removed and that unrelated Cache Storage buckets remain.

## PWA checks

The service-worker cache policy is kept in `public/sw-policy.js` so the worker
and its Node tests exercise the same rules. After changing the manifest,
service-worker lifecycle, navigation policy, or header status, run:

```bash
npx vitest run --project node src/lib/pwa
npx vitest run --project browser src/lib/pwa
npm run build
PWA_BUILD_SMOKE=1 npx vitest run --project node tests/pwa-build-smoke.test.ts
```

`tests/pwa-artifacts.test.ts` checks the source manifest, icon dimensions,
precache inputs, layout metadata, and worker lifecycle messages during normal
`npm test`. The opt-in build smoke must run after `npm run build`; it fails if
the server entry or required PWA files are absent from `dist`, and confirms that
the built worker files are the versions that were reviewed.

## Real-iPhone release checklist

Run this checklist in the production-like HTTPS environment, using an iPhone on
the oldest iOS version the release supports. Start with the site's Safari data
and any existing home-screen app removed.

### Install and first warm

1. Open the site in Safari, sign in, use **Share → Add to Home Screen**, and
   launch the installed app from its icon.
2. Confirm it opens in standalone mode with the expected name, icon, theme
   color, and safe-area layout. The app does not show its own install prompt.
3. Confirm the header starts at **Preparing offline** and does not report
   **Ready offline** early.
4. Keep the app online until it shows **Ready offline**. Visit `/`, `/new`,
   `/series`, `/search`, and `/cache`, plus another navigated series page.
5. Download at least two issues from one series, leaving a deliberate issue gap.
   Confirm their cover and metadata appear under Cached Comics.

### Cold offline launch

1. Force-close the PWA from the app switcher, enable airplane mode, and launch
   it again from the home-screen icon. Do not prime it in Safari first.
2. Confirm the normal shell renders, the header clearly says **Offline**, and
   the five root pages plus the previously visited series page open from their
   saved copies.
3. Open Cached Comics and confirm saved covers render (or the documented
   placeholder where a cover download failed), issue ordering is correct, and a
   saved issue opens at its normal `/comic/{id}/read` URL.
4. Read several pages, force-close, relaunch offline, and confirm reading resumes
   from local progress. At the end of the issue, verify a downloaded adjacent
   issue opens and the deliberate gap says **Next issue isn't downloaded**.
5. Open header search, confirm it is labelled as offline/downloaded-only, find a
   downloaded issue by series and issue metadata, and verify no online-only
   ComicVine results appear.

### Reconnect and replay

1. While still offline, change reading progress and perform an add-to-library
   action. Confirm the optimistic pending state/count is visible.
2. Restore connectivity, foreground or relaunch the PWA, and confirm both queued
   actions replay without requiring background sync.
3. Verify the pending count clears. On another signed-in device, create a newer
   reading-progress timestamp and confirm the newest timestamp wins rather than
   blindly accepting the offline value.

### Worker update on next launch

1. Keep the installed PWA open on the current release, deploy a build with a
   changed `sw.js`, and allow the browser to detect the update.
2. Confirm the active reading session is not reloaded or interrupted.
3. Force-close and relaunch the PWA. Confirm the waiting worker activates, the
   app reloads at most once under the new controller, and offline readiness is
   re-established before **Ready offline** appears.

### Purge, interruption, and best-effort storage

1. Start another comic download, interrupt connectivity or force-close before
   it completes, then relaunch. Confirm no partial issue is advertised in Cached
   Comics and a later download can succeed.
2. Remove a downloaded cover response (or reproduce a failed cover request) and
   confirm the readable issue remains, a placeholder appears, and a later online
   access can retry the cover.
3. Use Safari's website-data controls to evict the site's local data. Relaunch
   and confirm the app degrades to an empty/not-ready state without presenting
   evicted comics as available. Re-prime and redownload successfully.
4. Download a comic and queue an action again, then explicitly log out. Confirm
   cached pages, comics, covers, metadata, progress, and pending actions are all
   gone.
5. Sign in again, cache data, then invalidate the server session. On the next
   confirmed invalid-session response, confirm the same full purge occurs.
