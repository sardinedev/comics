/* global ComicsPwaPolicy */

importScripts("/sw-policy.js");

const VERSION = "v1";
const PAGE_CACHE = `comics-offline-pages-${VERSION}`;
const ASSET_CACHE = `comics-offline-assets-${VERSION}`;
const COVER_CACHE = "comics-offline-covers-v1";
const OFFLINE_DATABASE = "comics-offline";
const PWA_CACHE_PREFIXES = ["comics-offline-pages-", "comics-offline-assets-"];
const KNOWN_OFFLINE_CACHES = [
	"comic-reader-v1",
	"comic-reader-v2",
	PAGE_CACHE,
	ASSET_CACHE,
	COVER_CACHE,
];

const {
	SHELL_PAGES,
	STATIC_ASSETS,
	extractStaticAssetUrls,
	getDocumentFallbackPath,
	isCacheableAssetResponse,
	isCacheableDocumentResponse,
	isConfirmedAuthInvalidResponse,
	isDocumentRequest,
	isOfflineCoverRequest,
	isStaticAssetRequest,
} = ComicsPwaPolicy;

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(ASSET_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		Promise.all([deleteObsoletePwaCaches(), self.clients.claim()]),
	);
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;

	if (isDocumentRequest(event.request)) {
		event.respondWith(networkFirstDocument(event.request, url));
		return;
	}

	if (isStaticAssetRequest(event.request, url)) {
		event.respondWith(cacheFirstAsset(event.request));
		return;
	}

	if (isOfflineCoverRequest(event.request, url)) {
		event.respondWith(networkFirstCover(event.request));
	}
});

self.addEventListener("message", (event) => {
	const message = event.data;
	if (!message || typeof message.type !== "string") return;

	if (message.type === "ACTIVATE_UPDATE") {
		self.skipWaiting();
		return;
	}

	if (message.type === "WARM_OFFLINE") {
		event.waitUntil(
			warmOfflineShell()
				.then(() =>
					reply(event, { type: "WARM_RESULT", ok: true, version: VERSION }),
				)
				.catch((error) => {
					console.warn("[pwa] Offline warm-up failed", error);
					reply(event, { type: "WARM_RESULT", ok: false, version: VERSION });
				}),
		);
		return;
	}

	if (message.type === "GET_OFFLINE_STATUS") {
		event.waitUntil(
			isOfflineShellReady().then((ready) =>
				reply(event, { type: "OFFLINE_STATUS", ready, version: VERSION }),
			),
		);
		return;
	}

	if (message.type === "PURGE_OFFLINE") {
		event.waitUntil(
			purgeOfflineData().finally(() =>
				reply(event, { type: "PURGE_RESULT", ok: true }),
			),
		);
	}
});

async function networkFirstDocument(request, url) {
	try {
		const response = await fetch(request);
		if (isConfirmedAuthInvalidResponse(response, self.location.origin)) {
			await purgeOfflineData();
			await broadcast({ type: "AUTH_INVALIDATED" });
			return response;
		}
		if (isCacheableDocumentResponse(url, response)) {
			const cache = await caches.open(PAGE_CACHE);
			await cacheDocument(cache, url, response.clone());
		}
		return response;
	} catch (error) {
		const cached = await caches.match(request, { cacheName: PAGE_CACHE });
		if (cached) return cached;
		const fallbackPath = getDocumentFallbackPath(url.pathname);
		if (fallbackPath !== url.pathname) {
			const readerShell = await caches.match(
				new URL(fallbackPath, self.location.origin).href,
				{ cacheName: PAGE_CACHE },
			);
			if (readerShell) return readerShell;
		}
		throw error;
	}
}

async function cacheFirstAsset(request) {
	const cached = await caches.match(request, { cacheName: ASSET_CACHE });
	if (cached) return cached;

	const response = await fetch(request);
	if (isCacheableAssetResponse(response)) {
		const cache = await caches.open(ASSET_CACHE);
		await cache.put(request, response.clone());
	}
	return response;
}

async function matchDownloadedCover(request) {
	const cache = await caches.open(COVER_CACHE);
	const exact = await cache.match(request);
	if (exact) return exact;
	// Cover bytes belong to an issue's synthetic key. Match the recorded source
	// URL too, so cached server-rendered pages can reuse the same downloaded bytes.
	for (const key of await cache.keys()) {
		const response = await cache.match(key);
		if (response?.headers.get("x-comics-cover-url") === request.url)
			return response;
	}
}

async function networkFirstCover(request) {
	try {
		const response = await fetch(request);
		if (response.ok) return response;
		return (await matchDownloadedCover(request)) ?? response;
	} catch (error) {
		const cached = await matchDownloadedCover(request);
		if (cached) return cached;
		throw error;
	}
}

async function warmOfflineShell() {
	const pageCache = await caches.open(PAGE_CACHE);
	const assetUrls = new Set(
		STATIC_ASSETS.map((path) => new URL(path, self.location.origin).href),
	);

	for (const path of SHELL_PAGES) {
		const url = new URL(path, self.location.origin);
		const request = new Request(url.href, {
			credentials: "include",
			headers: { Accept: "text/html" },
		});
		const response = await fetch(request);
		if (isConfirmedAuthInvalidResponse(response, self.location.origin)) {
			await purgeOfflineData();
			await broadcast({ type: "AUTH_INVALIDATED" });
			throw new Error(`Authentication expired while warming ${url.pathname}`);
		}
		if (!isCacheableDocumentResponse(url, response)) {
			throw new Error(`Could not cache ${url.pathname}: ${response.status}`);
		}

		const html = await response.clone().text();
		for (const assetUrl of extractStaticAssetUrls(html, url)) {
			assetUrls.add(assetUrl);
		}
		await cacheDocument(pageCache, url, response);
	}

	await cacheShellAssets(assetUrls);
}

async function isOfflineShellReady() {
	const pageCache = await caches.open(PAGE_CACHE);
	const assetCache = await caches.open(ASSET_CACHE);
	const pageMatches = await Promise.all(
		SHELL_PAGES.map((path) =>
			pageCache.match(new URL(path, self.location.origin).href),
		),
	);
	const assetMatches = await Promise.all(
		STATIC_ASSETS.map((path) =>
			assetCache.match(new URL(path, self.location.origin).href),
		),
	);
	if (![...pageMatches, ...assetMatches].every(Boolean)) return false;
	const queue = [];
	for (let i = 0; i < pageMatches.length; i++) {
		queue.push(
			...extractStaticAssetUrls(
				await pageMatches[i].text(),
				new URL(SHELL_PAGES[i], self.location.origin),
			),
		);
	}
	const visited = new Set();
	while (queue.length) {
		const url = queue.shift();
		if (visited.has(url)) continue;
		visited.add(url);
		const response = await assetCache.match(url);
		if (!response) return false;
		const contentType = response.headers.get("content-type") || "";
		if (/javascript|text\/css|text\/html/.test(contentType)) {
			queue.push(
				...extractStaticAssetUrls(await response.text(), new URL(url)),
			);
		}
	}
	return true;
}

async function cacheDocument(cache, url, response) {
	const headers = new Headers(response.headers);
	// The offline copy is private to one signed-in user and keyed by its exact
	// URL. Removing Vary prevents a warm-up fetch and a later browser navigation
	// from missing one another solely because their Accept headers differ.
	headers.delete("vary");
	await cache.put(
		new Request(url.href),
		new Response(response.body, {
			headers,
			status: response.status,
			statusText: response.statusText,
		}),
	);
}

async function cacheShellAssets(initialUrls) {
	const assetCache = await caches.open(ASSET_CACHE);
	const queue = [...initialUrls];
	const visited = new Set();

	while (queue.length > 0) {
		const assetUrl = queue.shift();
		if (!assetUrl || visited.has(assetUrl)) continue;
		visited.add(assetUrl);

		const request = new Request(assetUrl, { credentials: "include" });
		let response = await assetCache.match(request);
		if (!response) {
			response = await fetch(request);
			if (!isCacheableAssetResponse(response)) {
				throw new Error(
					`Could not cache asset ${assetUrl}: ${response.status}`,
				);
			}
			await assetCache.put(request, response.clone());
		}

		const contentType = response.headers.get("content-type") || "";
		if (
			contentType.includes("javascript") ||
			contentType.includes("text/css") ||
			contentType.includes("text/html")
		) {
			const source = await response.text();
			for (const dependency of extractStaticAssetUrls(
				source,
				new URL(assetUrl),
			)) {
				if (!visited.has(dependency)) queue.push(dependency);
			}
		}
	}
}

async function deleteObsoletePwaCaches() {
	const names = await caches.keys();
	await Promise.all(
		names
			.filter(
				(name) =>
					PWA_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
					name !== PAGE_CACHE &&
					name !== ASSET_CACHE,
			)
			.map((name) => caches.delete(name)),
	);
}

async function purgeOfflineData() {
	await Promise.all([
		...KNOWN_OFFLINE_CACHES.map((name) => caches.delete(name)),
		deleteDatabase(OFFLINE_DATABASE),
	]);
}

function deleteDatabase(name) {
	return new Promise((resolve) => {
		const request = indexedDB.deleteDatabase(name);
		request.addEventListener("success", () => resolve());
		request.addEventListener("error", () => resolve());
		request.addEventListener("blocked", () => resolve());
	});
}

async function broadcast(message) {
	const windows = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	for (const client of windows) client.postMessage(message);
}

function reply(event, message) {
	if (event.ports?.[0]) {
		event.ports[0].postMessage(message);
		return;
	}
	if (event.source && "postMessage" in event.source)
		event.source.postMessage(message);
}
