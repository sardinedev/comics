import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const homepageSource = readFileSync(
	resolve(repoRoot, "src/pages/index.astro"),
	"utf8",
);

function iconAfterLabel(label: string) {
	const match = homepageSource.match(
		new RegExp(`aria-label="${label}"[\\s\\S]*?<Icon\\s+name="([^"]+)"`),
	);

	return match?.[1];
}

describe("homepage carousel controls", () => {
	it("uses existing paired icon assets for previous and next controls", () => {
		const previousIcon = iconAfterLabel("Previous slide");
		const nextIcon = iconAfterLabel("Next slide");

		expect(previousIcon).toBe("arrow-back");
		expect(nextIcon).toBe("arrow-forward");
		expect(
			existsSync(resolve(repoRoot, "public/icons", `${previousIcon}.svg`)),
		).toBe(true);
		expect(
			existsSync(resolve(repoRoot, "public/icons", `${nextIcon}.svg`)),
		).toBe(true);
	});
});
