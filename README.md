# Comics

An Astro server-side rendered (SSR) application for browsing and managing a personal comics library. Features a clean UI built with Astro components and Preact islands for interactivity, styled using Tailwind CSS.

## Overview

This app helps you:
- Browse your personal comics library
- Track series and issues from Mylar
- View weekly new releases from Comic Vine
- Manage cover images locally

## Tech Stack

- **Framework**: Astro 5 SSR with Node adapter
- **UI**: Astro components + Preact islands for interactivity
- **Styling**: Tailwind CSS 4
- **State**: Nanostores for client-side state management
- **Testing**: Vitest
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
| `npx vitest run`     | Run tests                                   |

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

## Requirements

- Node.js 22.12.0 (see `.nvmrc`)
- Elasticsearch instance
- Mylar instance
- Comic Vine API key
