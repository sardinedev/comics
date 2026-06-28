const PAGE_CACHE_NAME = "comic-page-v1";
const STATIC_CACHE_NAME = "comic-static-v1";
const COMIC_CACHE_NAME = "comic-reader-v1";
const STATIC_ASSET_PREFIXES = ["/_astro/", "/icons/"];
const STATIC_ASSET_PATHS = ["/favicon.svg", "/logo.svg"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE_NAME)
			.then((cache) => cache.addAll(STATIC_ASSET_PATHS))
			.catch(() => undefined),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter(
							(name) =>
								name.startsWith("comic-offline-shell-") ||
								(name.startsWith("comic-page-") && name !== PAGE_CACHE_NAME) ||
								(name.startsWith("comic-static-") &&
									name !== STATIC_CACHE_NAME),
						)
						.map((name) => caches.delete(name)),
				),
			),
	);
	self.clients.claim();
});

function isAppNavigation(request) {
	return request.mode === "navigate";
}

function isStaticAsset(url) {
	return (
		STATIC_ASSET_PATHS.includes(url.pathname) ||
		STATIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
	);
}

function isComicCacheRequest(url) {
	return /^\/api\/comic\/[^/]+\/(download|cache-metadata)$/.test(url.pathname);
}

function isCacheablePageResponse(response) {
	if (!response.ok || response.redirected) return false;
	if (response.headers.get("Cache-Control")?.includes("no-store")) return false;
	return response.headers.get("Content-Type")?.includes("text/html") ?? false;
}

function getHtmlAssetUrls(html) {
	const urls = new Set(STATIC_ASSET_PATHS);
	const attributePattern = /\b(?:href|src)="([^"]+)"/g;

	for (const match of html.matchAll(attributePattern)) {
		try {
			const assetUrl = new URL(match[1], self.location.origin);
			if (assetUrl.origin === self.location.origin && isStaticAsset(assetUrl)) {
				urls.add(`${assetUrl.pathname}${assetUrl.search}`);
			}
		} catch {
			/* Ignore malformed asset URLs in the shell HTML. */
		}
	}

	return [...urls];
}

async function cacheStaticAsset(assetUrl) {
	const staticCache = await caches.open(STATIC_CACHE_NAME);
	const cached = await staticCache.match(assetUrl);
	if (cached) return cached;

	const response = await fetch(assetUrl);
	if (response.ok) await staticCache.put(assetUrl, response.clone());
	return response;
}

async function cacheStaticAssetsFromHtml(response) {
	const html = await response.text();
	await Promise.all(
		getHtmlAssetUrls(html).map((assetUrl) =>
			cacheStaticAsset(assetUrl).catch(() => undefined),
		),
	);
}

async function respondWithStaticAsset(request) {
	const staticCache = await caches.open(STATIC_CACHE_NAME);
	const cached = await staticCache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await staticCache.put(request, response.clone());
	return response;
}

async function respondWithComicCache(request) {
	const comicCache = await caches.open(COMIC_CACHE_NAME);
	const cached = await comicCache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await comicCache.put(request, response.clone());
	return response;
}

async function cachePageAndAssets(pageCache, request, response) {
	await pageCache.put(request, response.clone());
	await cacheStaticAssetsFromHtml(response).catch(() => undefined);
}

async function respondWithAppNavigation(request, event) {
	const pageCache = await caches.open(PAGE_CACHE_NAME);

	try {
		const response = await fetch(request);
		if (isCacheablePageResponse(response)) {
			event.waitUntil(
				cachePageAndAssets(pageCache, request, response.clone()).catch(
					() => undefined,
				),
			);
		}
		return response;
	} catch {
		const cached = await pageCache.match(request);
		if (cached) return cached;

		return new Response("This page is not cached on this device yet.", {
			status: 503,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
}

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;

	if (isAppNavigation(event.request)) {
		event.respondWith(respondWithAppNavigation(event.request, event));
		return;
	}

	if (isComicCacheRequest(url)) {
		event.respondWith(respondWithComicCache(event.request));
		return;
	}

	if (isStaticAsset(url)) {
		event.respondWith(respondWithStaticAsset(event.request));
	}
});
