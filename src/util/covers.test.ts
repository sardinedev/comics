import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, test, vi } from "vitest";
import { extractCoverFromCbz } from "./covers";

vi.mock("@data/mylar/mylar", () => ({
	mylarDownloadIssue: vi.fn(),
}));

// Minimal magic-number fixtures: JPG_BYTES starts with JPEG SOI (0xFF,0xD8),
// PNG_BYTES starts with the PNG signature header (0x89, "PNG", CR, LF, SUB, LF).
// These are byte-signature stubs only, not complete valid image files.
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

function buildCbz(files: Record<string, Uint8Array>): Uint8Array {
	return zipSync(files);
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

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

describe("configured covers directory", () => {
	test.each(["relative", "absolute"])(
		"reads and writes covers with a %s COVERS_DIR",
		async (directoryType) => {
			const coversDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "comics-covers-"),
			);
			const configuredDir =
				directoryType === "absolute"
					? coversDir
					: path.relative(process.cwd(), coversDir);
			vi.stubEnv("COVERS_DIR", configuredDir);
			vi.resetModules();

			const covers = await import("./covers");
			const mylar = await import("@data/mylar/mylar");
			const cbz = buildCbz({ "001.jpg": JPG_BYTES });
			vi.mocked(mylar.mylarDownloadIssue).mockResolvedValue(cbz);
			vi.mocked(mylar.mylarDownloadIssue).mockClear();

			expect(covers.getCoverFilePath("123")).toBe(
				path.join(coversDir, "123.jpg"),
			);
			await expect(covers.coverExists("123")).resolves.toBe(false);
			await expect(covers.readCover("123")).resolves.toBeNull();

			await expect(
				covers.extractCoverFromDownloadedIssue("123"),
			).resolves.toEqual({
				success: true,
				url: "/covers/123.jpg",
				source: "cbz",
			});
			await expect(covers.readCover("123")).resolves.toEqual(JPG_BYTES);
			await expect(covers.coverExists("123")).resolves.toBe(true);

			await expect(
				covers.extractCoverFromDownloadedIssue("123"),
			).resolves.toEqual({
				success: true,
				url: "/covers/123.jpg",
				source: "cached",
			});
			expect(mylar.mylarDownloadIssue).toHaveBeenCalledTimes(1);
			await fs.rm(coversDir, { recursive: true, force: true });
		},
	);
});
