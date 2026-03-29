import type { estypes } from "@elastic/elasticsearch";
import { elastic } from "./elastic";
import type {
  ElasticBulkErrorItem,
  ElasticBulkSummary,
  ElasticUpsertDocument,
  ElasticBulkUpsertOptions,
} from "./elastic.types";

export function summarizeBulkResponse(
  response: estypes.BulkResponse,
  opts: { maxErrorsSample?: number } = {}
): ElasticBulkSummary {
  const maxErrorsSample = opts.maxErrorsSample ?? 10;
  const errorsSample: ElasticBulkErrorItem[] = [];

  // BulkResponse items are e.g. [{ update: {...}}, { index: {...}}]
  for (const item of response.items ?? []) {
    const [op, result] = Object.entries(item)[0] ?? [];
    if (!op || !result) continue;

    if (result.error) {
      errorsSample.push({
        index: result._index,
        id: result._id,
        status: result.status,
        error: result.error,
      });
      if (errorsSample.length >= maxErrorsSample) break;
    }
  }

  const errorCount = (response.items ?? []).reduce((acc, item) => {
    const [, result] = Object.entries(item)[0] ?? [];
    return acc + (result?.error ? 1 : 0);
  }, 0);

  return {
    took: response.took,
    errors: response.errors,
    errorCount,
    errorsSample,
  };
}

/**
 * Bulk upsert documents using `_bulk` with `update` actions.
 *
 * This is the safest default for sync jobs because:
 * - Updates are partial (won't wipe user fields like reading state)
 * - `upsert` provides full defaults on first insert
 */
export async function elasticBulkUpsertDocuments<
  TDoc extends Record<string, unknown>,
>(
  index: string,
  docs: ElasticUpsertDocument<TDoc>[],
  options: ElasticBulkUpsertOptions = {}
): Promise<ElasticBulkSummary> {

  const body: unknown[] = [];
  for (const { id, doc, upsert } of docs) {
    body.push({ update: { _index: index, _id: id } });
    body.push({ doc, upsert });
  }

  const response = await elastic.bulk({
    body,
    refresh: options.refresh,
  });

  const summary = summarizeBulkResponse(response);

  if (summary.errors) {
    const first = summary.errorsSample[0];
    const suffix = first
      ? ` First error: index=${first.index} id=${first.id} status=${first.status}`
      : "";
    throw new Error(
      `Elasticsearch bulk upsert had ${summary.errorCount} errors.${suffix}`
    );
  }

  return summary;
}
