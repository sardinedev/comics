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
    } catch {
      // Returns undefined for both "not found" and any ES errors —
      // the OAuth client treats a missing key as a cache miss and will
      // restart the flow rather than crashing.
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    await elastic.index({
      index: OAUTH_STORE_INDEX,
      id: `${this.prefix}:${key}`,
      document: { data: value, updated_at: new Date().toISOString() },
      // refresh: true ensures the document is immediately visible to subsequent
      // get() calls within the same request (ES is eventually consistent by default).
      refresh: true,
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
