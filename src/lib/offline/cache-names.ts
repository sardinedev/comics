/** Cache bucket containing downloaded comic archives and their metadata. */
export const COMIC_ARCHIVE_CACHE_NAME = "comic-reader-v2";

/** Cache buckets reserved for the PWA shell, documents, and offline covers. */
export const OFFLINE_ASSET_CACHE_NAME = "comics-offline-assets-v1";
export const OFFLINE_DOCUMENT_CACHE_NAME = "comics-offline-pages-v1";
export const OFFLINE_COVER_CACHE_NAME = "comics-offline-covers-v1";

/**
 * Prefixes of every cache bucket this app owns, including versions the service
 * worker may create later. Logout purges all of them.
 */
export const OFFLINE_CACHE_PREFIXES = [
	"comic-reader-",
	"comics-offline-",
] as const;
