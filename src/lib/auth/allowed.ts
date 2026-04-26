import { env } from "@lib/env";

/**
 * Returns the list of DIDs allowed to log in.
 *
 * Reads `AUTH_ALLOWED_DID`, which may contain a single DID or a
 * comma-separated list of DIDs (whitespace ignored, empty entries dropped).
 */
export function getAllowedDids(): string[] {
  const raw = env("AUTH_ALLOWED_DID") ?? "";
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

export function isAllowedDid(did: string | undefined | null): boolean {
  if (!did) return false;
  return getAllowedDids().includes(did);
}
