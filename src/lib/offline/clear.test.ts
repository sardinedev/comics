import { afterEach, expect, test, vi } from "vitest";
import { clearOfflineData } from "./clear";

afterEach(() => vi.unstubAllGlobals());

test("deletes only the cache buckets offline mode owns", async () => {
	const names = ["comic-reader-v2", "comics-offline-pages-v9", "unrelated"];
	const deleteCache = vi.fn(async () => true);
	vi.stubGlobal("caches", { keys: async () => names, delete: deleteCache });

	const result = await clearOfflineData();

	expect(result.deletedCaches).toEqual([
		"comic-reader-v2",
		"comics-offline-pages-v9",
	]);
	expect(deleteCache).toHaveBeenCalledTimes(2);
});
