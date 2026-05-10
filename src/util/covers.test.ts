import { zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { extractCoverFromCbz } from "./covers";

// Minimal magic-number signatures for image-type fixtures (not full valid images).
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

function buildCbz(files: Record<string, Uint8Array>): Uint8Array {
	return zipSync(files);
}

describe("extractCoverFromCbz", () => {
	test("returns the first image alphabetically", async () => {
		const cbz = buildCbz({
			"002.png": PNG_BYTES,
			"001.jpg": JPG_BYTES,
		});

		await expect(extractCoverFromCbz(cbz)).resolves.toEqual(JPG_BYTES);
	});

	test("ignores metadata and non-image entries", async () => {
		const cbz = buildCbz({
			"ComicInfo.xml": new TextEncoder().encode("<xml/>"),
			"__MACOSX/._001.png": PNG_BYTES,
			"001.png": PNG_BYTES,
		});

		await expect(extractCoverFromCbz(cbz)).resolves.toEqual(PNG_BYTES);
	});

	test("returns null when the archive has no image files", async () => {
		const cbz = buildCbz({
			"ComicInfo.xml": new TextEncoder().encode("<xml/>"),
		});

		await expect(extractCoverFromCbz(cbz)).resolves.toBeNull();
	});

	test("returns null for corrupt archives", async () => {
		await expect(
			extractCoverFromCbz(new Uint8Array([1, 2, 3, 4])),
		).resolves.toBeNull();
	});
});
