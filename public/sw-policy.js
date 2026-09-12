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

	function hasPathPrefix(pathname, prefix) {
		return pathname === prefix || pathname.startsWith(`${prefix}/`);
	}

	function isAuthPath(pathname) {
		return AUTH_PATHS.some((path) => hasPathPrefix(pathname, path));
	}

	function isExcludedDocumentPath(pathname) {
		return (
			isAuthPath(pathname) ||
			EXCLUDED_PATHS.some((path) => hasPathPrefix(pathname, path))
		);
	}

	function isDocumentRequest(request) {
		if (request.method !== "GET") return false;
		if (request.mode === "navigate" || request.destination === "document") {
			return true;
		}
		return (request.headers.get("accept") || "").includes("text/html");
	}

	function isComicReaderPath(pathname) {
		return /^\/comic\/[^/]+\/read\/?$/.test(pathname);
	}

	function getDocumentFallbackPath(pathname) {
		return isComicReaderPath(pathname) ? READER_SHELL_PATH : pathname;
	}

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

	function isStaticAssetUrl(url) {
		return (
			STATIC_PATHS.includes(url.pathname) ||
			STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
		);
	}

	function isStaticAssetRequest(request, url) {
		return request.method === "GET" && isStaticAssetUrl(url);
	}

	function isOfflineCoverRequest(request, url) {
		return (
			request.method === "GET" &&
			(url.pathname.startsWith("/covers/") ||
				/^\/offline\/comics\/[^/]+\/cover$/.test(url.pathname))
		);
	}

	function isCacheableAssetResponse(response) {
		return (
			response.status >= 200 && response.status < 300 && !response.redirected
		);
	}

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
