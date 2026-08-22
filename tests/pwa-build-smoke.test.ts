import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const builtClientRoot = resolve(repositoryRoot, "dist/client");
const runBuildSmoke = process.env.PWA_BUILD_SMOKE === "1";

function built(path: string): string {
	return resolve(builtClientRoot, path);
}

describe.skipIf(!runBuildSmoke)("built PWA smoke gate", () => {
	test("copies all root-scoped PWA files into the client build", () => {
		for (const path of [
			"manifest.webmanifest",
			"sw.js",
			"sw-policy.js",
			"pwa/icon-180.png",
			"pwa/icon-192.png",
			"pwa/icon-512.png",
		]) {
			expect(existsSync(built(path)), `Missing built artifact /${path}`).toBe(
				true,
			);
		}
	});

	test("keeps built worker sources identical to the reviewed public files", () => {
		for (const path of ["manifest.webmanifest", "sw.js", "sw-policy.js"]) {
			expect(readFileSync(built(path))).toEqual(
				readFileSync(resolve(repositoryRoot, "public", path)),
			);
		}
	});

	test("emits hashed client assets and the Node server entry", () => {
		const astroAssets = readdirSync(built("_astro"));
		expect(
			astroAssets.some((name) => /[_-][A-Za-z0-9_-]{6,}\./.test(name)),
		).toBe(true);
		expect(existsSync(resolve(repositoryRoot, "dist/server/entry.mjs"))).toBe(
			true,
		);
	});
});
