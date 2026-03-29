import type { estypes } from "@elastic/elasticsearch";

/**
 * A single failed item from an Elasticsearch bulk request.
 *
 * Note: Bulk responses can vary by operation type (index/create/update/delete),
 * but for our sync jobs we primarily emit `update` actions with `doc` + `upsert`.
 */
export type ElasticBulkErrorItem = {
  /** Target index name for the failed operation. */
  index: string;
  /** Document id, if the operation targeted a specific document. */
  id?: string | null;
  /** HTTP-like status code returned by Elasticsearch for this item. */
  status?: number;
  /** Raw error payload from Elasticsearch (shape depends on ES version/op). */
  error?: unknown;
};

/**
 * Summary of an Elasticsearch bulk request.
 *
 * We return a lightweight summary rather than the full `BulkResponse` to:
 * - keep call sites simple
 * - provide a stable error reporting surface
 */
export type ElasticBulkSummary = {
  /** Time Elasticsearch reports spending on the bulk request (ms). */
  took: number;
  /** Whether Elasticsearch reported any per-item errors. */
  errors: boolean;
  /** Count of items that contain an `error` in the response. */
  errorCount: number;
  /** Small sample of per-item errors (for logs / exceptions). */
  errorsSample: ElasticBulkErrorItem[];
};

/**
 * Describes a single document to be upserted.
 *
 * Semantics:
 * - `doc`: partial update applied when the document already exists
 * - `upsert`: full document inserted when the id does not exist
 *
 * This is the pattern we use for sync jobs to avoid overwriting user-owned fields
 * (e.g. reading progress) while still guaranteeing a complete shape on first insert.
 */
export type ElasticUpsertDocument<TDoc extends Record<string, unknown>> = {
  /** Document id (`_id`) to write to. */
  id: string;
  /** Partial update applied to existing documents. */
  doc: Partial<TDoc>;
  /** Full document inserted if the id does not exist. */
  upsert: TDoc;
};

/**
 * Options for bulk upsert helpers.
 */
export type ElasticBulkUpsertOptions = {
  /**
   * Refresh behavior after the bulk request.
   *
   * - `false` (default): fastest
   * - `wait_for`: convenient for dev/tests where subsequent reads must see writes
   */
  refresh?: estypes.Refresh;
};

/**
 * Options for a zero-downtime reindex operation.
 *
 * Used by `elasticReindex` to safely apply breaking schema changes by:
 * - creating a new index with new mappings/settings
 * - copying documents via `_reindex`
 * - atomically swapping the original name to point at the new index
 */
export type ElasticReindexOptions = {
  /** New mappings to apply to the destination index. */
  mappings: estypes.MappingTypeMapping;
  /** Optional suffix for the new index name (default: timestamp). */
  suffix?: string;
  /** Optional index settings (defaults to `DEFAULT_INDEX_SETTINGS`). */
  settings?: estypes.IndicesIndexSettings;
  /**
   * If true, preserves the old index by creating a backup alias (default: false).
   *
   * The backup alias name is derived from the source index and chosen suffix.
   */
  keepOldIndex?: boolean;
};
