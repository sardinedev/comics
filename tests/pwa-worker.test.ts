import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

const origin = "https://comics.test";

/** Exercises the shipped worker without requiring a server or browser registration. */
function createWorkerHarness() {
	const buckets = new Map<string, Map<string, Response>>();
	/** Makes relative warm-up URLs and absolute browser requests address the same entry. */
	function getCacheKey(request: string | Request): string {
		const requestUrl = typeof request === "string" ? request : request.url;
		return new URL(requestUrl, origin).href;
	}
	const cacheStorage = {
		/** Shares entries between worker operations as Cache Storage does. */
		async open(name: string) {
			let entries = buckets.get(name);
			if (!entries) {
				entries = new Map();
				buckets.set(name, entries);
			}
			const records = entries;
			return {
				/** Returns an independent body so reads cannot consume the stored response. */
				async match(request: string | Request) {
					return records.get(getCacheKey(request))?.clone();
				},
				/** Preserves stored bytes after the caller consumes its response. */
				async put(request: string | Request, response: Response) {
					records.set(getCacheKey(request), response.clone());
				},
				/** Exposes the requests needed to find a cover by its original URL. */
				async keys() {
					return [...records.keys()].map((url) => new Request(url));
				},
			};
		},
	};
	const fetcher = vi.fn(async (request: Request) => {
		const path = new URL(request.url).pathname;
		if (
			["/", "/new", "/series", "/search", "/cache", "/offline/reader"].includes(
				path,
			)
		) {
			return new Response(
				'<astro-island component-url="/_astro/reader.js" renderer-url="/_astro/client.js"></astro-island>',
				{ headers: { "Content-Type": "text/html" } },
			);
		}
		return new Response(
			path === "/_astro/reader.js" ? 'import "./dependency.js"' : "asset",
			{
				headers: {
					"Content-Type": path.endsWith(".js")
						? "application/javascript"
						: "image/png",
				},
			},
		);
	});
	const context = {
		URL,
		Request,
		Response,
		Headers,
		caches: cacheStorage,
		fetch: fetcher,
		self: {
			location: { origin },
			/** The harness calls handlers directly instead of registering browser events. */
			addEventListener() {},
		},
		/** The policy is evaluated explicitly in this same context below. */
		importScripts() {},
	};
	runInNewContext(
		readFileSync(new URL("../public/sw-policy.js", import.meta.url), "utf8"),
		context,
	);
	runInNewContext(
		readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
		context,
	);
	return {
		buckets,
		cacheStorage,
		fetcher,
		api: context as typeof context & {
			warmOfflineShell(): Promise<void>;
			isOfflineShellReady(): Promise<boolean>;
			networkFirstCover(request: Request): Promise<Response>;
		},
	};
}

describe("service worker integration", () => {
	test("warms island entries and transitive chunks before reporting readiness", async () => {
		const { api, buckets } = createWorkerHarness();
		await api.warmOfflineShell();
		const assets = buckets.get("comics-offline-assets-v1");
		if (!assets) throw new Error("Missing assets cache");
		for (const name of ["reader", "client", "dependency"])
			expect(assets.has(`${origin}/_astro/${name}.js`)).toBe(true);
		expect(await api.isOfflineShellReady()).toBe(true);
		assets.delete(`${origin}/_astro/dependency.js`);
		expect(await api.isOfflineShellReady()).toBe(false);
	});

	test("does not report ready after an island dependency fails to download", async () => {
		const { api, fetcher } = createWorkerHarness();
		const fetchAsset = fetcher.getMockImplementation();
		if (!fetchAsset) throw new Error("Missing fetch implementation");
		fetcher.mockImplementation(async (request) => {
			if (request.url.endsWith("dependency.js")) {
				return new Response(null, { status: 503 });
			}
			return fetchAsset(request);
		});
		await expect(api.warmOfflineShell()).rejects.toThrow(
			"Could not cache asset",
		);
		expect(await api.isOfflineShellReady()).toBe(false);
	});

	test("serves an original cover URL from the issue's downloaded response", async () => {
		const { api, fetcher, cacheStorage } = createWorkerHarness();
		const cache = await cacheStorage.open("comics-offline-covers-v1");
		await cache.put(
			"/offline/comics/issue/cover",
			new Response("cover bytes", {
				headers: { "x-comics-cover-url": `${origin}/covers/issue.jpg` },
			}),
		);
		fetcher.mockRejectedValue(new TypeError("offline"));
		const response = await api.networkFirstCover(
			new Request(`${origin}/covers/issue.jpg`),
		);
		expect(await response.text()).toBe("cover bytes");
		expect(await cache.keys()).toHaveLength(1);
		await expect(
			api.networkFirstCover(new Request(`${origin}/covers/other.jpg`)),
		).rejects.toThrow("offline");
	});
});
