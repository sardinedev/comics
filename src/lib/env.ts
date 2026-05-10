/**
 * Reads an environment variable from either Astro's import.meta.env (SSR context)
 * or process.env (Node scripts / cron jobs).
 */
const envLoaders = {
	COMICVINE_API_KEY: () =>
		import.meta.env?.COMICVINE_API_KEY ?? process.env.COMICVINE_API_KEY,
	PUBLIC_COMICVINE_URL: () =>
		import.meta.env?.PUBLIC_COMICVINE_URL ?? process.env.PUBLIC_COMICVINE_URL,
	ELASTIC_INDEX: () =>
		import.meta.env?.ELASTIC_INDEX ?? process.env.ELASTIC_INDEX,
	ELASTIC_URL: () => import.meta.env?.ELASTIC_URL ?? process.env.ELASTIC_URL,
	ELASTIC_API_KEY: () =>
		import.meta.env?.ELASTIC_API_KEY ?? process.env.ELASTIC_API_KEY,
	MYLAR_URL: () => import.meta.env?.MYLAR_URL ?? process.env.MYLAR_URL,
	MYLAR_API_KEY: () =>
		import.meta.env?.MYLAR_API_KEY ?? process.env.MYLAR_API_KEY,
	COVERS_DIR: () => import.meta.env?.COVERS_DIR ?? process.env.COVERS_DIR,
	PUBLIC_URL: () => import.meta.env?.PUBLIC_URL ?? process.env.PUBLIC_URL,
	ATPROTO_PRIVATE_KEY_JWK: () =>
		import.meta.env?.ATPROTO_PRIVATE_KEY_JWK ??
		process.env.ATPROTO_PRIVATE_KEY_JWK,
	AUTH_ALLOWED_DID: () =>
		import.meta.env?.AUTH_ALLOWED_DID ?? process.env.AUTH_ALLOWED_DID,
	AUTH_SESSION_SECRET: () =>
		import.meta.env?.AUTH_SESSION_SECRET ?? process.env.AUTH_SESSION_SECRET,
	DEV_BYPASS_AUTH: () =>
		import.meta.env?.DEV_BYPASS_AUTH ?? process.env.DEV_BYPASS_AUTH,
} satisfies Record<string, () => string | undefined>;

export type EnvKey = keyof typeof envLoaders;

export function env(key: EnvKey): string | undefined {
	return envLoaders[key]();
}
