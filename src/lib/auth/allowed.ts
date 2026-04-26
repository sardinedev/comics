import { env } from "@lib/env";

/**
 * Returns the list of DIDs allowed to log in.
 *
 * Reads `AUTH_ALLOWED_DID`, which may contain a single DID or a
 * comma-separated list of DIDs (whitespace ignored, empty entries dropped).
 *
 * Note: the env var is parsed on every call. Callers performing multiple
 * checks within a single request should cache the result locally rather
 * than re-invoking this function.
 */
export function getAllowedDids(): string[] {
  const raw = env("AUTH_ALLOWED_DID") ?? "";
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}
