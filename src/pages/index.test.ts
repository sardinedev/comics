import { readFileSync } from "node:fs";
import { parse } from "@astrojs/compiler";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.astro", import.meta.url), "utf8");

type AstroNode = {
	type?: string;
	name?: string;
	value?: unknown;
	attributes?: Array<{ name: string; value: unknown }>;
	children?: AstroNode[];
};

function findNode(node: AstroNode, predicate: (node: AstroNode) => boolean) {
	if (predicate(node)) {
		return node;
	}

	for (const child of node.children ?? []) {
		const result = findNode(child, predicate);
		if (result) {
			return result;
		}
	}
}

function attributeValue(node: AstroNode, name: string) {
	const value = node.attributes?.find(
		(attribute) => attribute.name === name,
	)?.value;
	return typeof value === "string"
		? value
		: Array.isArray(value)
			? value.map((part) => part.value).join("")
			: undefined;
}

describe("homepage hero cover", () => {
	it("uses a strict 2:3 cover ratio at the featured width", async () => {
		const { ast } = await parse(source);
		const root = ast as AstroNode;

		const heroCover = findNode(root, (node) => {
			const className = attributeValue(node, "class");
			return (
				node.type === "element" &&
				node.name === "div" &&
				className?.includes("aspect-[2/3]") === true &&
				className.includes("w-[220px]")
			);
		});
		const heroImage = findNode(root, (node) => {
			const alt = attributeValue(node, "alt");
			return (
				node.type === "component" &&
				node.name === "Image" &&
				alt?.includes("Cover for") === true
			);
		});

		expect(heroCover).toBeDefined();
		expect(attributeValue(heroImage ?? {}, "widths")).toBe("[220, 440]");
		expect(attributeValue(heroImage ?? {}, "sizes")).toBe("220px");
		expect(attributeValue(heroImage ?? {}, "width")).toBe("220");
		expect(attributeValue(heroImage ?? {}, "height")).toBe("330");
		expect(source).not.toContain("h-[340px] w-[220px]");
	});
});
