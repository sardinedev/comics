/** Existing cache bucket containing downloaded comic archives. */
export const LEGACY_COMIC_ARCHIVE_CACHE_NAME = "comic-reader-v1";
export const COMIC_ARCHIVE_CACHE_NAME = "comic-reader-v2";

/** Cache buckets reserved for the PWA shell, documents, and offline covers. */
export const OFFLINE_ASSET_CACHE_NAME = "comics-offline-assets-v1";
export const OFFLINE_DOCUMENT_CACHE_NAME = "comics-offline-pages-v1";
export const OFFLINE_COVER_CACHE_NAME = "comics-offline-covers-v1";

/** Every Cache Storage bucket owned by offline mode and cleared on logout. */
export const KNOWN_OFFLINE_CACHE_NAMES = [
	LEGACY_COMIC_ARCHIVE_CACHE_NAME,
	COMIC_ARCHIVE_CACHE_NAME,
	OFFLINE_ASSET_CACHE_NAME,
	OFFLINE_DOCUMENT_CACHE_NAME,
	OFFLINE_COVER_CACHE_NAME,
] as const;
