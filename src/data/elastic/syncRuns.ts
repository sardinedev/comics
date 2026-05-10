import { randomUUID } from "node:crypto";
import type {
  SyncProgressReporter,
  SyncProgressSnapshot,
  SyncStats,
} from "@data/sync/mylar-to-elastic";
import { elastic, elasticInitializeIndex } from "./elastic";
import { ISSUES_INDEX } from "./models/issue.model";
import {
  SYNC_RUNS_INDEX,
  type SyncRunDocument,
  type SyncRunKind,
  syncRunsMappings,
} from "./models/sync-run.model";

const ENRICHMENT_STALE_AFTER_MS = 10 * 60 * 1000;

type CreateSyncRunInput = {
  kind: SyncRunKind;
  enrichFromComicVine: boolean;
  cacheCovers: boolean;
  seriesLimit?: number;
};

export type EnrichmentMonitorSnapshot = {
  overview: {
    totalIssues: number;
    enrichedIssues: number;
    pendingIssues: number;
    percentComplete: number;
    staleAfterSeconds: number;
    generatedAt: string;
  };
  latestRun: SyncRunDocument | null;
  isLatestRunStale: boolean;
};

let ensureSyncRunsIndexPromise: Promise<void> | null = null;

/**
 * Ensures the sync-runs index exists before operational status is written/read.
 * Caches the in-flight initialization so concurrent requests do not race.
 *
 * @returns A promise that resolves once the index is ready.
 */
export function ensureSyncRunsIndex(): Promise<void> {
  if (!ensureSyncRunsIndexPromise) {
    ensureSyncRunsIndexPromise = elasticInitializeIndex(
      SYNC_RUNS_INDEX,
      syncRunsMappings,
    ).catch((error) => {
      ensureSyncRunsIndexPromise = null;
      throw error;
    });
  }

  return ensureSyncRunsIndexPromise;
}

/**
 * Returns the current timestamp in the ISO format stored in Elasticsearch.
 *
 * @returns Current UTC timestamp as an ISO string.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Converts an unknown thrown value into a message safe to store in a sync run.
 *
 * @param error - Unknown error value caught from sync execution.
 * @returns A readable error message.
 */
function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Maps sync statistics from the sync module's camelCase shape to sync-run fields.
 *
 * @param stats - Latest sync counters.
 * @returns Partial sync-run counter update.
 */
function statsToRunUpdate(
  stats: SyncStats,
): Pick<
  SyncRunDocument,
  "series_synced" | "issues_upserted" | "issues_enriched" | "covers_cached"
> {
  return {
    series_synced: stats.seriesSynced,
    issues_upserted: stats.issuesUpserted,
    issues_enriched: stats.issuesEnriched,
    covers_cached: stats.coversCached,
  };
}

/**
 * Converts a live sync progress snapshot into an Elasticsearch document update.
 *
 * @param snapshot - Current sync progress reported by the sync loop.
 * @returns Partial sync-run document fields to persist.
 */
function snapshotToRunUpdate(
  snapshot: SyncProgressSnapshot,
): Partial<SyncRunDocument> {
  return {
    enrich_from_comicvine: snapshot.enrichFromComicVine,
    cache_covers: snapshot.cacheCovers,
    series_limit: snapshot.seriesLimit,
    series_seen: snapshot.seriesSeen,
    series_total: snapshot.seriesTotal,
    issues_seen: snapshot.issuesSeen,
    ...statsToRunUpdate(snapshot.stats),
    current_series_id: snapshot.currentSeries?.id ?? null,
    current_series_name: snapshot.currentSeries?.name ?? null,
    current_issue_id: snapshot.currentIssue?.id ?? null,
    current_issue_number: snapshot.currentIssue?.number ?? null,
    current_issue_name: snapshot.currentIssue?.name ?? null,
  };
}

/**
 * Creates a new running sync-run document for a cron/manual sync invocation.
 *
 * @param input - Sync mode and options used by the run.
 * @returns The created sync-run document, including its generated run id.
 */
export async function createSyncRun(
  input: CreateSyncRunInput,
): Promise<SyncRunDocument> {
  await ensureSyncRunsIndex();

  const timestamp = nowIso();
  const run: SyncRunDocument = {
    run_id: randomUUID(),
    kind: input.kind,
    status: "running",
    started_at: timestamp,
    updated_at: timestamp,
    enrich_from_comicvine: input.enrichFromComicVine,
    cache_covers: input.cacheCovers,
    series_limit: input.seriesLimit,
    series_seen: 0,
    series_total: 0,
    series_synced: 0,
    issues_seen: 0,
    issues_upserted: 0,
    issues_enriched: 0,
    covers_cached: 0,
  };

  await elastic.index({
    index: SYNC_RUNS_INDEX,
    id: run.run_id,
    document: run,
    refresh: "wait_for",
  });

  return run;
}

/**
 * Applies a partial update to an existing sync-run document and refreshes its heartbeat.
 *
 * @param runId - Sync-run document id.
 * @param update - Fields to merge into the run document.
 */
export async function updateSyncRun(
  runId: string,
  update: Partial<SyncRunDocument>,
): Promise<void> {
  await elastic.update({
    index: SYNC_RUNS_INDEX,
    id: runId,
    doc: {
      ...update,
      updated_at: nowIso(),
    },
  });
}

/**
 * Marks a sync run as completed and stores its final counters.
 *
 * @param runId - Sync-run document id.
 * @param stats - Final stats returned by the sync operation.
 */
export async function completeSyncRun(
  runId: string,
  stats: SyncStats,
): Promise<void> {
  const timestamp = nowIso();
  await updateSyncRun(runId, {
    status: "completed",
    completed_at: timestamp,
    series_seen: stats.seriesSeen,
    series_total: stats.seriesSynced,
    ...statsToRunUpdate(stats),
    current_series_id: null,
    current_series_name: null,
    current_issue_id: null,
    current_issue_number: null,
    current_issue_name: null,
    last_error: null,
  });
}

/**
 * Marks a sync run as failed and stores the failure message.
 *
 * @param runId - Sync-run document id.
 * @param error - Error that caused the sync to fail.
 */
export async function failSyncRun(
  runId: string,
  error: unknown,
): Promise<void> {
  const timestamp = nowIso();
  await updateSyncRun(runId, {
    status: "failed",
    completed_at: timestamp,
    last_error: serializeError(error),
  });
}

/**
 * Builds a sync progress reporter that persists every progress event to Elasticsearch.
 *
 * @param runId - Sync-run document id to update.
 * @returns Progress reporter accepted by the sync loop.
 */
export function createSyncRunProgressReporter(
  runId: string,
): SyncProgressReporter {
  const writeSnapshot = (snapshot: SyncProgressSnapshot) =>
    updateSyncRun(runId, snapshotToRunUpdate(snapshot));

  return {
    start: writeSnapshot,
    seriesStart: writeSnapshot,
    seriesFetched: writeSnapshot,
    issueEnrichmentStart: writeSnapshot,
    issueEnriched: writeSnapshot,
    seriesComplete: writeSnapshot,
  };
}

/**
 * Fetches the latest sync-run document for a given sync kind.
 *
 * @param kind - Run category to search for.
 * @returns Most recent run document, or null when no run has been recorded.
 */
export async function getLatestSyncRun(
  kind: SyncRunKind,
): Promise<SyncRunDocument | null> {
  await ensureSyncRunsIndex();

  const response = await elastic.search<SyncRunDocument>({
    index: SYNC_RUNS_INDEX,
    size: 1,
    query: { term: { kind } },
    sort: [{ started_at: "desc" }],
  });

  return response.hits.hits[0]?._source ?? null;
}

/**
 * Counts total issues and issues that have ComicVine enrichment markers.
 * Existing character data is treated as legacy enrichment evidence.
 *
 * @returns Enrichment coverage counts and percentage.
 */
async function getEnrichmentCoverage() {
  const enrichedQuery = {
    bool: {
      should: [
        { exists: { field: "comicvine_enriched_at" } },
        { exists: { field: "characters" } },
      ],
      minimum_should_match: 1,
    },
  };

  const [totalResponse, enrichedResponse] = await Promise.all([
    elastic.count({ index: ISSUES_INDEX }),
    elastic.count({ index: ISSUES_INDEX, query: enrichedQuery }),
  ]);

  const totalIssues = totalResponse.count;
  const enrichedIssues = enrichedResponse.count;

  return {
    totalIssues,
    enrichedIssues,
    pendingIssues: Math.max(0, totalIssues - enrichedIssues),
    percentComplete:
      totalIssues > 0 ? Math.round((enrichedIssues / totalIssues) * 100) : 0,
  };
}

/**
 * Builds the monitor snapshot consumed by the sync status API and UI.
 * A running job is marked stale only after a long quiet period so the normal
 * ComicVine throttle does not produce false stale warnings.
 *
 * @param now - Clock value used for stale-run calculation, injectable for tests.
 * @returns Current enrichment coverage, latest enrichment run, and stale status.
 */
export async function getEnrichmentMonitorSnapshot(
  now: Date = new Date(),
): Promise<EnrichmentMonitorSnapshot> {
  const [coverage, latestRun] = await Promise.all([
    getEnrichmentCoverage(),
    getLatestSyncRun("enrichment"),
  ]);

  const updatedAtMs = latestRun ? Date.parse(latestRun.updated_at) : Number.NaN;
  const isLatestRunStale = Boolean(
    latestRun?.status === "running" &&
    Number.isFinite(updatedAtMs) &&
    now.getTime() - updatedAtMs > ENRICHMENT_STALE_AFTER_MS,
  );

  return {
    overview: {
      ...coverage,
      staleAfterSeconds: ENRICHMENT_STALE_AFTER_MS / 1000,
      generatedAt: now.toISOString(),
    },
    latestRun,
    isLatestRunStale,
  };
}
