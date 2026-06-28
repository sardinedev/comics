const APP_SHELL_CACHE = "comic-offline-shell-v1";
const COMIC_CACHE_NAME = "comic-reader-v1";
const OFFLINE_SHELL_URL = "/offline";
const STATIC_ASSET_PREFIXES = ["/_astro/", "/icons/"];
const STATIC_ASSET_PATHS = ["/favicon.svg", "/logo.svg"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(APP_SHELL_CACHE)
			.then((cache) => cache.addAll([OFFLINE_SHELL_URL, ...STATIC_ASSET_PATHS]))
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
								name.startsWith("comic-offline-shell-") &&
								name !== APP_SHELL_CACHE,
						)
						.map((name) => caches.delete(name)),
				),
			),
	);
	self.clients.claim();
});

function isOfflineNavigation(url, request) {
	return (
		request.mode === "navigate" &&
		(url.pathname === "/offline" || url.pathname.startsWith("/offline/"))
	);
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

async function respondWithOfflineShell() {
	const shellCache = await caches.open(APP_SHELL_CACHE);

	try {
		const response = await fetch(OFFLINE_SHELL_URL);
		if (response.ok) await shellCache.put(OFFLINE_SHELL_URL, response.clone());
		if (response.ok) return response;
	} catch {
		/* Fall back to the cached shell below. */
	}

	try {
		const cached = await shellCache.match(OFFLINE_SHELL_URL);
		if (cached) return cached;
	} catch {
		/* Return the explicit offline miss response below. */
	}

	return new Response("Offline shell is not cached on this device yet.", {
		status: 503,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

async function respondWithStaticAsset(request) {
	const shellCache = await caches.open(APP_SHELL_CACHE);
	const cached = await shellCache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await shellCache.put(request, response.clone());
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

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;

	if (isOfflineNavigation(url, event.request)) {
		event.respondWith(respondWithOfflineShell());
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
