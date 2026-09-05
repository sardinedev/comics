/** Shares the offline routing contract between the worker and its policy tests. */
(function defineComicsPwaPolicy(root) {
	const ROOT_PAGES = ["/", "/new", "/series", "/search", "/cache"];
	const READER_SHELL_PATH = "/offline/reader";
	const SHELL_PAGES = [...ROOT_PAGES, READER_SHELL_PATH];
	const STATIC_ASSETS = [
		"/manifest.webmanifest",
		"/favicon.svg",
		"/logo.svg",
		"/pwa/icon-180.png",
		"/pwa/icon-192.png",
		"/pwa/icon-512.png",
	];
	const AUTH_PATHS = ["/login", "/logout", "/oauth", "/api/auth"];
	const EXCLUDED_PATHS = ["/api", "/client-metadata.json"];
	const STATIC_PATH_PREFIXES = ["/_astro/", "/icons/", "/pwa/"];
	const STATIC_PATHS = ["/favicon.svg", "/logo.svg", "/manifest.webmanifest"];

	/** Keeps route families distinct so similarly named public paths are not excluded. */
	function hasPathPrefix(pathname, prefix) {
		return pathname === prefix || pathname.startsWith(`${prefix}/`);
	}

	/** Recognizes destinations that indicate a session must be re-established. */
	function isAuthPath(pathname) {
		return AUTH_PATHS.some((path) => hasPathPrefix(pathname, path));
	}

	/** Keeps authentication and API responses out of the private navigation cache. */
	function isExcludedDocumentPath(pathname) {
		return (
			isAuthPath(pathname) ||
			EXCLUDED_PATHS.some((path) => hasPathPrefix(pathname, path))
		);
	}

	/** Includes client-side HTML transitions in the same offline policy as navigations. */
	function isDocumentRequest(request) {
		if (request.method !== "GET") return false;
		if (request.mode === "navigate" || request.destination === "document") {
			return true;
		}
		return (request.headers.get("accept") || "").includes("text/html");
	}

	/** Limits the generic reader fallback to routes that identify a comic. */
	function isComicReaderPath(pathname) {
		return /^\/comic\/[^/]+\/read\/?$/.test(pathname);
	}

	/** Preserves normal reader URLs when only the generic shell is available offline. */
	function getDocumentFallbackPath(pathname) {
		return isComicReaderPath(pathname) ? READER_SHELL_PATH : pathname;
	}

	/** Prevents redirects and failed requests from replacing a usable offline page. */
	function isCacheableDocumentResponse(url, response) {
		const contentType = response.headers.get("content-type") || "";
		return (
			!isExcludedDocumentPath(url.pathname) &&
			response.status >= 200 &&
			response.status < 300 &&
			!response.redirected &&
			contentType.toLowerCase().includes("text/html")
		);
	}

	/** Limits shell storage to assets owned by this application. */
	function isStaticAssetUrl(url) {
		return (
			STATIC_PATHS.includes(url.pathname) ||
			STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
		);
	}

	/** Avoids applying asset caching to requests that can change server state. */
	function isStaticAssetRequest(request, url) {
		return request.method === "GET" && isStaticAssetUrl(url);
	}

	/** Lets downloaded covers serve both cached pages and the local library. */
	function isOfflineCoverRequest(request, url) {
		return (
			request.method === "GET" &&
			(url.pathname.startsWith("/covers/") ||
				/^\/offline\/comics\/[^/]+\/cover$/.test(url.pathname))
		);
	}

	/** Prevents transient errors from becoming persistent offline assets. */
	function isCacheableAssetResponse(response) {
		return (
			response.status >= 200 && response.status < 300 && !response.redirected
		);
	}

	/** Requires explicit authentication evidence before erasing private offline data. */
	function isConfirmedAuthInvalidResponse(response, expectedOrigin) {
		if (response.headers.get("x-comics-auth-invalid") === "true") return true;
		if (!response.redirected) return false;
		try {
			const url = new URL(response.url);
			return (
				(!expectedOrigin || url.origin === expectedOrigin) &&
				isAuthPath(url.pathname)
			);
		} catch {
			return false;
		}
	}

	/** Finds the dependencies a cached page needs to hydrate and render offline. */
	function extractStaticAssetUrls(html, baseUrl) {
		const urls = new Set();
		const patterns = [
			/(?:src|href|component-url|renderer-url)\s*=\s*["']([^"'#]+)["']/gi,
			/url\(\s*["']?([^"')#]+)["']?\s*\)/gi,
			/(?:from\s*|import\s*\(\s*|import\s*)["']([^"'#]+)["']/gi,
		];

		for (const pattern of patterns) {
			for (const match of html.matchAll(pattern)) {
				try {
					const url = new URL(match[1], baseUrl);
					if (url.origin === baseUrl.origin && isStaticAssetUrl(url)) {
						urls.add(url.href);
					}
				} catch {
					// Ignore malformed URLs in a document that is otherwise cacheable.
				}
			}
		}

		return [...urls];
	}

	root.ComicsPwaPolicy = Object.freeze({
		READER_SHELL_PATH,
		ROOT_PAGES,
		SHELL_PAGES,
		STATIC_ASSETS,
		extractStaticAssetUrls,
		getDocumentFallbackPath,
		isAuthPath,
		isCacheableAssetResponse,
		isCacheableDocumentResponse,
		isConfirmedAuthInvalidResponse,
		isComicReaderPath,
		isDocumentRequest,
		isExcludedDocumentPath,
		isOfflineCoverRequest,
		isStaticAssetRequest,
		isStaticAssetUrl,
	});
})(globalThis);
