import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const homepageSource = readFileSync(
	resolve(repoRoot, "src/pages/index.astro"),
	"utf8",
);

describe("homepage carousel controls", () => {
	it("uses existing paired icon assets for previous and next controls", () => {
		const iconNames = Array.from(
			homepageSource.matchAll(/<Icon\s+name="([^"]+)"/g),
			(match) => match[1],
		);

		expect(homepageSource).toContain('aria-label="Previous slide"');
		expect(homepageSource).toContain('aria-label="Next slide"');
		expect(iconNames).toContain("arrow-back");
		expect(iconNames).toContain("arrow-forward");
		for (const iconName of iconNames) {
			expect(
				existsSync(resolve(repoRoot, "public/icons", `${iconName}.svg`)),
			).toBe(true);
		}
	});
});
