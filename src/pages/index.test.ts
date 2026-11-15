import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const homepageSource = readFileSync(
	resolve(repoRoot, "src/pages/index.astro"),
	"utf8",
);

function tagsOf(source: string, tagName: string) {
	return source.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) ?? [];
}

function attributeValue(tag: string, name: string) {
	const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|\\{([^}]*)\\})`));
	return match ? (match[1] ?? match[2]) : undefined;
}

describe("homepage carousel controls", () => {
	it("uses existing paired icon assets for previous and next controls", () => {
		const carouselIcons = ["arrow-back", "arrow-forward"];

		expect(homepageSource).toContain('aria-label="Previous slide"');
		expect(homepageSource).toContain('aria-label="Next slide"');
		for (const iconName of carouselIcons) {
			expect(homepageSource).toContain(`name="${iconName}"`);
			expect(
				existsSync(resolve(repoRoot, "public/icons", `${iconName}.svg`)),
			).toBe(true);
		}
	});
});

describe("homepage hero cover", () => {
	it("uses a strict 2:3 cover ratio at the featured width", () => {
		const heroCover = tagsOf(homepageSource, "div").find((tag) => {
			const className = attributeValue(tag, "class");
			return (
				className?.includes("aspect-[2/3]") === true &&
				className.includes("w-[220px]")
			);
		});
		const heroImage = tagsOf(homepageSource, "Image").find((tag) =>
			tag.includes("alt={`Cover for"),
		);

		expect(heroCover).toBeDefined();
		expect(heroImage).toBeDefined();
		expect(attributeValue(heroImage ?? "", "widths")).toBe("[220, 440]");
		expect(attributeValue(heroImage ?? "", "sizes")).toBe("220px");
		expect(attributeValue(heroImage ?? "", "width")).toBe("220");
		expect(attributeValue(heroImage ?? "", "height")).toBe("330");
		expect(homepageSource).not.toContain("h-[340px] w-[220px]");
	});
});
