import { elastic } from "@data/elastic/elastic";
import { OAUTH_STORE_INDEX } from "@data/elastic/models/oauth-store.model";

/**
 * Elasticsearch-backed key/value store for ATProto OAuth state and sessions.
 *
 * `@atproto/oauth-client-node` requires two pluggable stores:
 *   - stateStore   — holds PKCE/PAR state during the authorization flow (short-lived)
 *   - sessionStore — holds access + refresh tokens after a successful login (long-lived)
 *
 * Both use this same class, instantiated with different prefixes so their keys
 * don't collide in the shared `comics_oauth_store` Elasticsearch index:
 *   state entries:   `state:{key}`
 *   session entries: `session:{key}`
 *
 * Note: there is no automatic TTL. State entries are deleted by the OAuth client
 * after a successful callback. Abandoned flows leave orphaned `state:*` documents
 * that can be cleaned up manually. See docs/AUTH.md for details.
 */
export class ElasticKeyedStore<T = unknown> {
  constructor(private readonly prefix: string) { }

  async get(key: string): Promise<T | undefined> {
    try {
      const res = await elastic.get<{ data: T }>({
        index: OAUTH_STORE_INDEX,
        id: `${this.prefix}:${key}`,
      });
      return res._source?.data;
    } catch (error) {
      const status =
        typeof error === "object" && error !== null
          ? ("statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number"
              ? (error as { statusCode: number }).statusCode
              : "meta" in error &&
                  typeof (error as { meta: { statusCode?: unknown } }).meta?.statusCode === "number"
                ? (error as { meta: { statusCode: number } }).meta.statusCode
                : undefined)
          : undefined;
      if (status === 404) return undefined;
      throw error;
    }
  }

  async set(key: string, value: T): Promise<void> {
    await elastic.index({
      index: OAUTH_STORE_INDEX,
      id: `${this.prefix}:${key}`,
      document: { data: value, updated_at: new Date().toISOString() },
      // 'wait_for' ensures the document is visible to subsequent get() calls
      // without forcing an immediate shard refresh on every write.
      refresh: "wait_for",
    });
  }

  async del(key: string): Promise<void> {
    try {
      await elastic.delete({
        index: OAUTH_STORE_INDEX,
        id: `${this.prefix}:${key}`,
      });
    } catch {
      // Ignore "not found" — del() is called speculatively during cleanup
      // and should not throw if the document was already removed.
    }
  }
}
