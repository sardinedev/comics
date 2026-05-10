import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.astro", import.meta.url), "utf8");

describe("homepage hero cover", () => {
	it("uses a strict 2:3 cover ratio at the featured width", () => {
		expect(source).toContain("aspect-[2/3] w-[220px]");
		expect(source).not.toContain("h-[340px] w-[220px]");
		expect(source).toContain("width={220}");
		expect(source).toContain("height={330}");
	});
});
