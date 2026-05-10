/**
 * Reads an environment variable from either Node's process environment or
 * Astro/Vite's statically exposed import.meta.env values.
 *
 * Vite does not allow dynamic import.meta.env access, so every key used by the
 * app is listed explicitly here.
 */
export function env(key: string): string | undefined {
	return process.env[key] ?? importMetaEnv(key);
}

/**
 * Reads known Astro/Vite environment variables using static property access.
 *
 * @param key - Environment variable name requested by the app.
 * @returns The import.meta.env value for known keys, or undefined.
 */
function importMetaEnv(key: string): string | undefined {
	if (!("env" in import.meta)) return undefined;

	switch (key) {
		case "ATPROTO_PRIVATE_KEY_JWK":
			return import.meta.env.ATPROTO_PRIVATE_KEY_JWK;
		case "AUTH_ALLOWED_DID":
			return import.meta.env.AUTH_ALLOWED_DID;
		case "AUTH_SESSION_SECRET":
			return import.meta.env.AUTH_SESSION_SECRET;
		case "COMICVINE_API_KEY":
			return import.meta.env.COMICVINE_API_KEY;
		case "COVERS_DIR":
			return import.meta.env.COVERS_DIR;
		case "DEV_BYPASS_AUTH":
			return import.meta.env.DEV_BYPASS_AUTH;
		case "ELASTIC_API_KEY":
			return import.meta.env.ELASTIC_API_KEY;
		case "ELASTIC_INDEX":
			return import.meta.env.ELASTIC_INDEX;
		case "ELASTIC_URL":
			return import.meta.env.ELASTIC_URL;
		case "MYLAR_API_KEY":
			return import.meta.env.MYLAR_API_KEY;
		case "MYLAR_URL":
			return import.meta.env.MYLAR_URL;
		case "PUBLIC_COMICVINE_URL":
			return import.meta.env.PUBLIC_COMICVINE_URL;
		case "PUBLIC_URL":
			return import.meta.env.PUBLIC_URL;
		default:
			return undefined;
	}
}
