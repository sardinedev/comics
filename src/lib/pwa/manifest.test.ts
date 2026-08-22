import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface WebManifest {
	background_color: string;
	display: string;
	icons: Array<{ purpose: string; sizes: string; src: string; type: string }>;
	scope: string;
	start_url: string;
	theme_color: string;
}

const manifest = JSON.parse(
	readFileSync(
		new URL("../../../public/manifest.webmanifest", import.meta.url),
		"utf8",
	),
) as WebManifest;

describe("PWA manifest", () => {
	it("opens the root app shell in standalone mode", () => {
		expect(manifest.start_url).toBe("/");
		expect(manifest.scope).toBe("/");
		expect(manifest.display).toBe("standalone");
		expect(manifest.background_color).toBe("#0f172a");
		expect(manifest.theme_color).toBe("#0f172a");
	});

	it("provides installable PNG icons with a maskable safe area", () => {
		expect(manifest.icons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					purpose: "any maskable",
					sizes: "192x192",
					type: "image/png",
				}),
				expect.objectContaining({
					purpose: "any maskable",
					sizes: "512x512",
					type: "image/png",
				}),
			]),
		);
	});
});
