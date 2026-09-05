import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

interface CachePolicy {
	READER_SHELL_PATH: string;
	SHELL_PAGES: string[];
	extractStaticAssetUrls(html: string, baseUrl: URL): string[];
	getDocumentFallbackPath(pathname: string): string;
	isComicReaderPath(pathname: string): boolean;
	isCacheableDocumentResponse(url: URL, response: Response): boolean;
	isDocumentRequest(request: Request): boolean;
	isExcludedDocumentPath(pathname: string): boolean;
	isOfflineCoverRequest(request: Request, url: URL): boolean;
}

const context: { ComicsPwaPolicy?: CachePolicy; URL: typeof URL } = { URL };
const source = readFileSync(
	new URL("../../../public/sw-policy.js", import.meta.url),
	"utf8",
);
runInNewContext(source, context);
const policy = context.ComicsPwaPolicy;
if (!policy) throw new Error("Service-worker cache policy did not initialise");

describe("service-worker document policy", () => {
	it("includes the generic reader shell in offline readiness", () => {
		expect(policy.READER_SHELL_PATH).toBe("/offline/reader");
		expect(policy.SHELL_PAGES).toContain("/offline/reader");
	});

	it.each([
		["/comic/123/read", true],
		["/comic/an%20issue/read/", true],
		["/comic/123", false],
		["/offline/reader", false],
	])("recognises reader fallback path %s", (pathname, expected) => {
		expect(policy.isComicReaderPath(pathname)).toBe(expected);
	});

	it("routes only normal reader URLs to the generic shell on failure", () => {
		expect(policy.getDocumentFallbackPath("/comic/123/read")).toBe(
			"/offline/reader",
		);
		expect(policy.getDocumentFallbackPath("/series/123")).toBe("/series/123");
	});

	it.each([
		"/",
		"/new",
		"/series/123/name",
		"/search?q=batman",
	])("allows app document %s", (pathname) => {
		expect(policy.isExcludedDocumentPath(pathname)).toBe(false);
	});

	it.each([
		"/login",
		"/oauth/callback",
		"/logout",
		"/api/search",
		"/api/auth/logout",
		"/client-metadata.json",
	])("excludes sensitive route %s", (pathname) => {
		expect(policy.isExcludedDocumentPath(pathname)).toBe(true);
	});

	it("recognises Astro transition fetches as document requests", () => {
		const request = new Request("https://comics.example/series", {
			headers: { Accept: "text/html, application/xhtml+xml" },
		});
		expect(policy.isDocumentRequest(request)).toBe(true);
	});

	it("routes original and synthetic cover GETs through the downloaded-cover fallback", () => {
		const coverUrl = new URL("https://comics.example/covers/series/issue.jpg");
		expect(policy.isOfflineCoverRequest(new Request(coverUrl), coverUrl)).toBe(
			true,
		);
		const cachedCoverUrl = new URL(
			"https://comics.example/offline/comics/issue-1/cover",
		);
		expect(
			policy.isOfflineCoverRequest(new Request(cachedCoverUrl), cachedCoverUrl),
		).toBe(true);
		expect(
			policy.isOfflineCoverRequest(
				new Request("https://comics.example/_image?href=cover"),
				new URL("https://comics.example/_image?href=cover"),
			),
		).toBe(false);
		expect(
			policy.isOfflineCoverRequest(
				new Request(coverUrl, { method: "POST" }),
				coverUrl,
			),
		).toBe(false);
	});

	it("caches only successful non-redirected HTML", () => {
		const url = new URL("https://comics.example/series");
		const html = new Response("<h1>Series</h1>", {
			headers: { "Content-Type": "text/html; charset=utf-8" },
			status: 200,
		});
		const error = new Response("error", {
			headers: { "Content-Type": "text/html" },
			status: 500,
		});
		const json = new Response("{}", {
			headers: { "Content-Type": "application/json" },
			status: 200,
		});

		expect(policy.isCacheableDocumentResponse(url, html)).toBe(true);
		expect(policy.isCacheableDocumentResponse(url, error)).toBe(false);
		expect(policy.isCacheableDocumentResponse(url, json)).toBe(false);
		expect(
			policy.isCacheableDocumentResponse(
				new URL("https://comics.example/login"),
				html,
			),
		).toBe(false);
	});

	it("extracts only same-origin shell assets from cached HTML", () => {
		const html = `
			<link href="/_astro/page.css" rel="stylesheet">
			<script src="/_astro/page.js"></script>
			<img src="/icons/home.svg">
			<img src="/covers/issue.jpg">
			<script src="https://cdn.example/app.js"></script>
		`;
		expect(
			policy.extractStaticAssetUrls(
				html,
				new URL("https://comics.example/series"),
			),
		).toEqual([
			"https://comics.example/_astro/page.css",
			"https://comics.example/_astro/page.js",
			"https://comics.example/icons/home.svg",
		]);
	});

	it("extracts transitive JavaScript module dependencies", () => {
		const source = `
			import { openDatabase } from "./database.js";
			const reader = import("./reader.js");
		`;
		expect(
			policy.extractStaticAssetUrls(
				source,
				new URL("https://comics.example/_astro/page.js"),
			),
		).toEqual([
			"https://comics.example/_astro/database.js",
			"https://comics.example/_astro/reader.js",
		]);
	});
});
