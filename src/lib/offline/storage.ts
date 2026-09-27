export type StorageSummary = {
	usage: number;
	quota: number;
	persisted: boolean;
};

/**
 * Asks the browser to exempt this origin from storage-pressure eviction (and
 * Safari's 7-day script-storage cap). Browsers grant it by heuristics, so a
 * false result is normal; calling it again is harmless.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.storage?.persist)
		return false;
	if (await navigator.storage.persisted()) return true;
	return navigator.storage.persist();
}

/** Origin-wide usage and quota, or null when the browser does not report them. */
export async function getStorageSummary(): Promise<StorageSummary | null> {
	if (typeof navigator === "undefined" || !navigator.storage?.estimate)
		return null;
	const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
		navigator.storage.estimate(),
		navigator.storage.persisted?.() ?? Promise.resolve(false),
	]);
	return { usage, quota, persisted };
}

/** Whether Cache Storage or IndexedDB rejected a write because storage is full. */
export function isQuotaExceededError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "QuotaExceededError";
}
