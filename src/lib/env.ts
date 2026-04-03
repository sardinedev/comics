/**
 * Reads an environment variable from either Astro's import.meta.env (SSR context)
 * or process.env (Node scripts / cron jobs).
 */
export function env(key: string): string | undefined {
  return (import.meta as any).env?.[key] ?? process.env[key];
}
