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
