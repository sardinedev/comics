# Hosting

The webapp is built as a docker container and deployed to a private VPS. The following services are used by the webapp and hosted in the same VPS:

- Elasticsearch: for storing and indexing comic issue data.
- Mylar: for managing the comic book collection and tracking issues.

The app also talks to Comic Vine (public API) for weekly releases and as a fallback for issue details.

## Runtime dependencies

- **Elasticsearch**: required for most browsing pages (series listing, issue pages when the issue is in the library).
- **Mylar**: required for sync/seed flows, adding series to your library, and downloading cover artwork.
- **Comic Vine**: required for `/new` (weekly comics) and as a fallback when an issue is not found in Elasticsearch.

## Persistent storage

The app stores cover images locally in `data/covers/`. This directory must be persisted across container restarts.

### Docker volume configuration

The `docker-compose.yml` includes a named volume for covers:

```yaml
volumes:
  - covers_data:/app/data/covers
```

### TrueNAS / host path

For TrueNAS or other setups where you want a host-mounted path:

```yaml
volumes:
  - /mnt/pool/appdata/comics/covers:/app/data/covers
```

Create the directory first:

```bash
mkdir -p /mnt/pool/appdata/comics/covers
```

## Networking

- The web container must be able to reach Mylar and Elasticsearch over the VPS network.
- If Elasticsearch/Mylar are bound to localhost, ensure the container can still connect (e.g. host networking, bridge + proper bind address, or putting services on the same Docker network).
- If you put Cloudflare in front of the webapp, confirm your origin (the VPS) only exposes the ports you intend.

## Deployment

This repo includes a `Dockerfile` and a minimal `docker-compose.yml` for running the Astro server container.

Typical lifecycle:

- Build an image from the repo.
- Run the container with the required env vars.
- On updates: rebuild/pull the new image and restart the container.
- For debugging: check container logs and verify connectivity to Mylar/Elasticsearch from inside the container.

## CDN

The webapp uses Cloudflare as a CDN to cache static assets.

### PWA and authenticated caching

Offline mode requires HTTPS in production. The service worker is served from
`/sw.js` with root scope and loads `/sw-policy.js`. A valid public certificate is
required; an HTTP origin or a certificate warning is not an acceptable PWA test
environment. (`localhost` is treated as secure for desktop development but does
not cover iPhone installation.)

Both worker URLs must revalidate on every request so iOS can discover a new
release. They must never receive an `immutable` directive or a long edge TTL.
The manifest should also revalidate so install metadata changes are discovered.
A suitable origin/CDN policy is:

| Path | Recommended response policy |
| --- | --- |
| `/sw.js` | `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: no-cache, must-revalidate`, no CDN cache override |
| `/sw-policy.js` | `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: no-cache, must-revalidate`, no CDN cache override |
| `/manifest.webmanifest` | `Content-Type: application/manifest+json`, `Cache-Control: public, max-age=0, must-revalidate` |
| `/_astro/*` | `Cache-Control: public, max-age=31536000, immutable` because filenames are content-hashed |
| `/pwa/*`, `/favicon.svg`, `/logo.svg`, `/icons/*` | Revalidate or use a bounded TTL; these URLs are not content-hashed and must not be immutable |
| Authenticated HTML and `/api/*` | Private/no shared caching; preserve the application's origin headers |

`/sw.js` already sits at the origin root, so its default scope is `/`. A reverse
proxy must not redirect it, rewrite it to HTML, require authentication for it,
or strip service-worker-related response headers. The registration also uses
`updateViaCache: none`, but that browser option is defense in depth rather than
a replacement for correct CDN headers.

Do not configure Cloudflare to publicly cache authenticated HTML routes. Those
responses contain personal library data and are cached only in the signed-in
user's browser by the service worker. Hashed `/_astro/*` assets and PWA icons may
use different policies: only the hashed `/_astro/*` assets should be immutable.
PWA icons have stable filenames and should revalidate or use a bounded TTL.

When Cloudflare is used, create higher-priority cache rules for `/sw.js`,
`/sw-policy.js`, and `/manifest.webmanifest` before the general static-asset
rule. Do not use **Cache Everything** for signed-in routes. Purging Cloudflare is
not a reliable service-worker update strategy; correct response headers must
work for every deployment.

Production verification should confirm:

- `/manifest.webmanifest` returns the manifest content type and lists the 192px
  and 512px PNG icons.
- `/sw.js` and `/sw-policy.js` are served from the application origin without a
  redirect, revalidate successfully, and do not include `immutable`.
- The manifest revalidates, and only content-hashed `/_astro/*` responses use a
  one-year immutable policy.
- Authenticated requests to `/`, `/new`, `/series`, `/search`, and `/cache` reach
  the origin and are not stored in a shared CDN cache.
- Releasing a changed `/sw.js` produces a waiting worker, which activates on the
  next app launch rather than interrupting the current session.

Example header checks against the deployed origin:

```bash
curl -I https://comics.example/sw.js
curl -I https://comics.example/sw-policy.js
curl -I https://comics.example/manifest.webmanifest
curl -I https://comics.example/_astro/<content-hashed-file>.js
```

Also inspect Cloudflare's cache-status header. Worker responses should be
revalidated rather than served indefinitely from an edge cache, while the
content-hashed asset may be a cache hit.
