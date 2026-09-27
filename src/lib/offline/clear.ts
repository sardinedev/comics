import { OFFLINE_CACHE_PREFIXES } from "./cache-names";
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

async function ownedCacheNames(): Promise<string[]> {
	const names = await caches.keys();
	return names.filter((name) =>
		OFFLINE_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)),
	);
}

async function deleteOfflineCaches(
	requestedNames: readonly string[] | undefined,
): Promise<string[]> {
	if (typeof caches === "undefined") return [];
	const cacheNames = requestedNames ?? (await ownedCacheNames());

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
 * offline mode. Cache Storage is shared with the service worker, so this is
 * the single purge path. Only explicit logout calls it.
 */
export async function clearOfflineData(
	options: ClearOfflineDataOptions = {},
): Promise<ClearOfflineDataResult> {
	const [databaseDeleted, deletedCaches] = await Promise.all([
		deleteOfflineDatabase(),
		deleteOfflineCaches(options.cacheNames),
	]);

	return { databaseDeleted, deletedCaches };
}
