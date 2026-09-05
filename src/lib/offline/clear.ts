import { KNOWN_OFFLINE_CACHE_NAMES } from "./cache-names";
import {
	closeOfflineDatabase,
	getOfflineDatabaseName,
	isOfflineStorageSupported,
} from "./database";

export type ClearOfflineDataResult = {
	databaseDeleted: boolean;
	deletedCaches: string[];
};

export type ClearOfflineDataOptions = {
	/** Test seam for isolating Cache Storage buckets on a shared origin. */
	cacheNames?: readonly string[];
};

async function deleteOfflineDatabase(): Promise<boolean> {
	if (!isOfflineStorageSupported()) return false;
	await closeOfflineDatabase();

	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(getOfflineDatabaseName());
		request.onsuccess = () => resolve(true);
		request.onerror = () => reject(request.error);
	});
}

async function deleteOfflineCaches(
	cacheNames: readonly string[],
): Promise<string[]> {
	if (typeof caches === "undefined") return [];

	const results = await Promise.all(
		cacheNames.map(async (cacheName) => ({
			cacheName,
			deleted: await caches.delete(cacheName),
		})),
	);

	return results
		.filter(({ deleted }) => deleted)
		.map(({ cacheName }) => cacheName);
}

/**
 * Permanently removes every IndexedDB and Cache Storage bucket owned by
 * offline mode. Authentication code can call this without importing UI code.
 */
export async function clearOfflineData(
	options: ClearOfflineDataOptions = {},
): Promise<ClearOfflineDataResult> {
	const [databaseDeleted, deletedCaches] = await Promise.all([
		deleteOfflineDatabase(),
		deleteOfflineCaches(options.cacheNames ?? KNOWN_OFFLINE_CACHE_NAMES),
	]);

	return { databaseDeleted, deletedCaches };
}
