# Comics

An Astro server-side rendered (SSR) application for browsing, downloading, and reading a personal comics library. It is an installable iOS PWA with an offline app shell, locally saved comics, and a UI built with Astro components, Preact islands, and Tailwind CSS.

## Overview

This app helps you:
- Browse your personal comics library
- Track series and issues from Mylar
- View weekly new releases from Comic Vine
- Manage cover images locally
- Install the app on iOS and navigate saved pages while offline
- Download comics for offline reading

## Tech Stack

- **Framework**: Astro 7 SSR with Node adapter
- **UI**: Astro components + Preact islands for interactivity
- **Styling**: Tailwind CSS 4
- **State**: Nanostores for client-side state management
- **Testing**: Vitest with Playwright-backed Chromium and opt-in WebKit coverage
- **Language**: TypeScript

## Commands

All commands are run from the root of the project:

| Command              | Action                                      |
| :------------------- | :------------------------------------------ |
| `npm install`        | Install dependencies                        |
| `npm run dev`        | Start dev server at `localhost:4321`        |
| `npm run build`      | Build production site to `./dist/`          |
| `npm run preview`    | Preview build locally before deploying      |
| `npm run type:check` | Run Astro type checking                     |
| `npm run type:check:tsc` | Run TypeScript checking               |
| `npm run lint`       | Run Biome checks                            |
| `npm test`           | Run unit and browser tests                  |

## PWA release checks

Routine `npm test` uses Chromium so a missing optional WebKit binary does not
break local development. Before an iOS PWA release, run the WebKit and built-
artifact gates as well:

```bash
npx playwright install webkit
PWA_WEBKIT=1 npx vitest run --project browser
npm run build
PWA_BUILD_SMOKE=1 npx vitest run --project node tests/pwa-build-smoke.test.ts
```

WebKit automation covers browser API compatibility, but installation,
force-close behavior, storage eviction, and service-worker promotion still need
the [real-iPhone checklist](docs/TESTING.md#real-iphone-release-checklist).

## Project Structure

```text
/
├── data/
│   └── covers/              # Local cover image cache
├── docs/                    # Project documentation
├── public/                  # Static assets
│   └── icons/
└── src/
    ├── components/          # Astro components + Preact islands
    ├── data/               # Data layer (API clients, models)
    │   ├── comicvine/      # Comic Vine API client
    │   ├── elastic/        # Elasticsearch client & models
    │   └── mylar/          # Mylar API client
    ├── layouts/            # Page layouts
    ├── pages/              # Astro pages & API routes
    ├── stores/             # Nanostores for client state
    ├── styles/             # Global CSS
    └── util/               # Utilities & helpers
```

## Documentation

Detailed documentation is available in the `docs/` folder:

- [Conventions](docs/CONVENTIONS.md) - Coding standards and patterns
- [Data Sources](docs/DATA_SOURCES.md) - API integrations (Mylar, Comic Vine, Elasticsearch)
- [Cover Images](docs/COVER_IMAGES.md) - Cover caching and serving
- [Testing](docs/TESTING.md) - Testing approach
- [Hosting](docs/HOSTING.md) - Deployment and infrastructure
- [Offline mode](docs/OFFLINE.md) - PWA, local storage, and cache policy

## Requirements

- Node.js 24.18.0 (see `.nvmrc`)
- Elasticsearch instance
- Mylar instance
- Comic Vine API key
