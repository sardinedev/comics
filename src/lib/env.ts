/**
 * Reads an environment variable from either Astro's import.meta.env (SSR context)
 * or process.env (Node scripts / cron jobs).
 */
export function env(key: string): string | undefined {
	const meta = import.meta as ImportMeta & {
		env?: Record<string, string | undefined>;
	};
	return meta.env?.[key] ?? process.env[key];
}
