import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = resolve(repositoryRoot, "public");

function readText(path: string): string {
	return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function pngDimensions(path: string): { height: number; width: number } {
	const png = readFileSync(path);
	expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
	expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

type ManifestIcon = {
	purpose: string;
	sizes: string;
	src: string;
	type: string;
};

type PwaManifest = {
	background_color: string;
	display: string;
	icons: ManifestIcon[];
	name: string;
	scope: string;
	short_name: string;
	start_url: string;
	theme_color: string;
};

type ServiceWorkerPolicy = {
	READER_SHELL_PATH: string;
	ROOT_PAGES: string[];
	SHELL_PAGES: string[];
	STATIC_ASSETS: string[];
};

describe("PWA release artifacts", () => {
	test("ships a root-scoped standalone manifest with real iOS-sized PNGs", () => {
		const manifest = JSON.parse(
			readText("public/manifest.webmanifest"),
		) as PwaManifest;

		expect(manifest).toMatchObject({
			name: "Sardines Reading Comics",
			short_name: "Sardines",
			start_url: "/",
			scope: "/",
			display: "standalone",
			background_color: "#0f172a",
			theme_color: "#0f172a",
		});

		for (const size of [192, 512]) {
			const icon = manifest.icons.find(
				(candidate) => candidate.sizes === `${size}x${size}`,
			);
			expect(icon).toMatchObject({
				type: "image/png",
				purpose: expect.stringContaining("any"),
			});
			const iconPath = resolve(publicRoot, icon?.src.replace(/^\//, "") ?? "");
			expect(existsSync(iconPath)).toBe(true);
			expect(pngDimensions(iconPath)).toEqual({ width: size, height: size });
		}

		const appleTouchIcon = resolve(publicRoot, "pwa/icon-180.png");
		expect(pngDimensions(appleTouchIcon)).toEqual({ width: 180, height: 180 });
	});

	test("keeps service-worker policy parseable and every precached asset present", () => {
		const policySource = readText("public/sw-policy.js");
		const context: {
			ComicsPwaPolicy?: ServiceWorkerPolicy;
			URL: typeof URL;
		} = { URL };
		runInNewContext(policySource, context);
		const policy = context.ComicsPwaPolicy;
		expect(policy).toBeDefined();
		expect(policy?.ROOT_PAGES).toEqual([
			"/",
			"/new",
			"/series",
			"/search",
			"/cache",
		]);
		expect(policy?.READER_SHELL_PATH).toBe("/offline/reader");
		expect(policy?.SHELL_PAGES).toEqual([
			...(policy?.ROOT_PAGES ?? []),
			"/offline/reader",
		]);

		for (const asset of policy?.STATIC_ASSETS ?? []) {
			expect(
				existsSync(resolve(publicRoot, asset.replace(/^\//, ""))),
				`Missing service-worker asset ${asset}`,
			).toBe(true);
		}
	});

	test("ships a parseable worker with warm, readiness, update, and purge paths", () => {
		const worker = readText("public/sw.js");
		expect(() => new Script(worker, { filename: "sw.js" })).not.toThrow();
		expect(worker).toContain('importScripts("/sw-policy.js")');
		expect(worker).toContain('message.type === "WARM_OFFLINE"');
		expect(worker).toContain('message.type === "GET_OFFLINE_STATUS"');
		expect(worker).toContain('message.type === "ACTIVATE_UPDATE"');
		expect(worker).toContain('message.type === "PURGE_OFFLINE"');
		expect(worker).toContain("SHELL_PAGES.map");
		expect(worker).toContain("KNOWN_OFFLINE_CACHES.map");
		expect(worker).toContain("deleteDatabase(OFFLINE_DATABASE)");
	});

	test("includes install and lifecycle metadata in both application layouts", () => {
		for (const layout of [
			"src/layouts/Layout.astro",
			"src/layouts/ReaderLayout.astro",
		]) {
			const source = readText(layout);
			expect(source).toContain('rel="manifest" href="/manifest.webmanifest"');
			expect(source).toContain(
				'rel="apple-touch-icon" href="/pwa/icon-180.png"',
			);
			expect(source).toContain('name="apple-mobile-web-app-capable"');
			expect(source).toContain("void initialisePwa()");
		}
	});
});
