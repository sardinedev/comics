import { mylarGetAllSeries, mylarGetHistory, mylarGetSeries } from "../mylar/mylar";
import type { MylarComic, MylarIssue, MylarHistoryItem } from "../mylar/mylar.types";
import { getComicIssueDetails } from "../comicvine/comicvine";
import { ensureCoverCached, generateThumbHash } from "../../util/covers";
import { ISSUES_INDEX } from "../elastic/models/issue.model";
import { elastic, elasticBulkUpsertDocuments } from "../elastic/elastic";
import type { ReadingState, Issue } from "../comics.types";

/**
 * Configuration options for syncing Mylar library to Elasticsearch.
 *
 * The sync process is an ETL pipeline that:
 * 1. Fetches all series and issues from Mylar
 * 2. Optionally enriches with ComicVine metadata (better dates, descriptions)
 * 3. Optionally caches cover images locally
 * 4. Bulk upserts to Elasticsearch using partial updates to preserve user data
 */
export type MylarToElasticSyncOptions = {
  /** If true, calls ComicVine per-issue for richer metadata (slower; rate-limited). */
  enrichFromComicVine?: boolean;
  /** If true, downloads downloaded issues to extract and cache covers locally. */
  cacheCovers?: boolean;
  /** Limit number of series synced (useful for testing). */
  seriesLimit?: number;
  /** Max concurrent per-issue ComicVine enrichment calls. */
  comicVineConcurrency?: number;
  /** Refresh after bulk (useful in dev/tests). */
  refresh?: "true" | "false" | "wait_for";
};

/**
 * Statistics returned after a sync operation.
 */
export type SyncStats = {
  seriesSeen: number;
  seriesSynced: number;
  issuesUpserted: number;
  issuesEnriched: number;
  coversCached: number;
};

/**
 * Document shape for partial updates to Elasticsearch.
 *
 * Derived from the full Issue type by omitting all reading state fields.
 * This ensures sync updates don't overwrite user's reading progress.
 *
 * TypeScript will enforce that any changes to Issue are reflected here automatically.
 */
type IssueElasticDoc = Omit<
  Issue,
  | "reading_state"
  | "started_reading_at"
  | "last_opened_at"
  | "completed_at"
  | "current_page"
  | "is_favorite"
  | "user_rating"
>;

/**
 * Complete document shape for inserts (upsert case).
 *
 * When an issue doesn't exist in Elasticsearch yet, we insert a full document
 * with default reading state values. This ensures new issues start as "unread".
 *
 * Note: This requires all reading state fields to be present (not optional),
 * so we pick them explicitly and make them required.
 */
type IssueElasticUpsert = IssueElasticDoc & {
  reading_state: ReadingState;
  current_page: number;
  is_favorite: boolean;
};

/**
 * Parse Mylar history timestamp to ISO 8601 format.
 *
 * Mylar stores dates as "YYYY-MM-DD HH:MM:SS" in local time.
 * We normalize to ISO UTC for consistent storage in Elasticsearch.
 *
 * @param dateAdded - Raw date string from Mylar history
 * @returns ISO 8601 UTC string, or null if parsing fails
 */
function parseMylarHistoryDateAdded(dateAdded: string): string | null {
  // Replace space with 'T' to make it ISO-compatible
  const normalized = dateAdded.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Choose the best issue date from available sources.
 *
 * Priority order:
 * 1. ComicVine store_date (most accurate when available)
 * 2. Mylar releaseDate (if not 0000-00-00)
 * 3. Mylar issueDate (if not 0000-00-00)
 * 4. Fallback to 1900-01-01 for unknown dates
 *
 * @param issue - Mylar issue data
 * @param comicVineStoreDate - Optional ComicVine store date (enrichment)
 * @returns ISO date string (YYYY-MM-DD)
 */
function pickIssueDate(issue: MylarIssue, comicVineStoreDate?: string): string {
  // Priority 1: ComicVine store_date (most accurate)
  if (comicVineStoreDate) {
    return comicVineStoreDate;
  }

  // Priority 2: Mylar releaseDate (if valid)
  if (issue.releaseDate !== "0000-00-00") {
    return issue.releaseDate;
  }

  // Priority 3: Mylar issueDate (if valid)
  if (issue.issueDate !== "0000-00-00") {
    return issue.issueDate;
  }

  // Fallback: Unknown date placeholder
  return "1900-01-01";
}

/**
 * Convert issue number string to float.
 *
 * Supports fractional issues like "1.1", "2.5", etc.
 * Returns 0 if parsing fails.
 */
function toFloatIssueNumber(numberStr: string): number {
  const parsedValue = Number.parseFloat(numberStr);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

/**
 * Extract series metadata from Mylar comic data.
 *
 * This denormalizes series info into each issue document for fast querying
 * without joins (Elasticsearch doesn't support JOINs efficiently).
 */
function buildSeriesInfo(series: MylarComic) {
  return {
    series_name: series.name,
    series_year: series.year,
    series_publisher: series.publisher,
    series_total_issues: series.totalIssues,
  } satisfies Partial<IssueElasticDoc>;
}

/**
 * Build Elasticsearch document and upsert payload for an issue.
 *
 * Returns both:
 * - `doc`: Partial update applied to existing documents (preserves reading state)
 * - `upsert`: Full document inserted if issue doesn't exist yet
 *
 * This pattern ensures:
 * - Syncs update metadata without overwriting user's reading progress
 * - New issues get sensible defaults (unread, page 0, not favorited)
 *
 * @param issue - Mylar issue data
 * @param series - Mylar series data
 * @param opts - Additional fields (cover URL, description, dates)
 */
function buildIssueBaseDoc(
  issue: MylarIssue,
  series: MylarComic,
  opts: {
    nowIso: string;
    coverUrl?: string;
    thumbHash?: string;
    issueDescription?: string;
    issueDate: string;
    addedToLibraryAt?: string;
    characters?: string[];
  }
): { doc: IssueElasticDoc; upsert: IssueElasticUpsert } {
  const seriesInfo = buildSeriesInfo(series);

  // Build partial update (doesn't include reading state fields)
  const doc: IssueElasticDoc = {
    issue_id: issue.id,
    series_id: series.id,

    issue_number: toFloatIssueNumber(issue.number),
    issue_name: issue.name ?? undefined,
    issue_description: opts.issueDescription,
    issue_date: opts.issueDate,
    issue_cover_url: opts.coverUrl,
    issue_cover_thumb_hash: opts.thumbHash,
    characters: opts.characters,
    ...seriesInfo,
    download_status: issue.status,
    added_to_library_at: opts.addedToLibraryAt,
    synced_at: opts.nowIso,
  };

  // Build complete document for insert case (includes reading state defaults)
  const upsert: IssueElasticUpsert = {
    ...doc,
    reading_state: "unread",
    current_page: 0,
    is_favorite: false,
  };

  return { doc, upsert };
}


/**
 * Build a map of issue IDs to their "added to library" timestamps.
 *
 * Walks Mylar history to find when each issue was first Downloaded/Post-Processed.
 * We prefer the earliest timestamp to get a stable "added_to_library_at" value.
 *
 * @param history - Mylar history entries
 * @returns Map of IssueID -> ISO timestamp
 */
function buildDownloadedAtMap(history: MylarHistoryItem[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const item of history) {
    const issueId = item.IssueID;
    if (!issueId) continue;

    // Only track "Downloaded" or "Post-Processed" status transitions
    if (item.Status !== "Downloaded" && item.Status !== "Post-Processed") continue;

    const iso = parseMylarHistoryDateAdded(item.DateAdded);
    if (!iso) continue;

    const existing = map.get(issueId);
    if (!existing) {
      map.set(issueId, iso);
      continue;
    }

    // Keep the earliest timestamp we saw this issue downloaded
    if (iso < existing) {
      map.set(issueId, iso);
    }
  }

  return map;
}

/**
 * Simple sleep utility to pause execution for a given number of milliseconds.
 * Used to throttle ComicVine API calls to avoid rate limits.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync all comic issues from Mylar to Elasticsearch.
 *
 * ETL Pipeline:
 * 1. **Extract**: Fetch series, issues, and history from Mylar API
 * 2. **Transform**:
 *    - Map Mylar fields to Elasticsearch schema
 *    - Optionally enrich with ComicVine metadata (better dates, descriptions)
 *    - Optionally cache cover images locally
 *    - Derive "added_to_library_at" from Mylar history
 * 3. **Load**: Bulk upsert to Elasticsearch using partial updates
 *
 * Key behaviors:
 * - Uses `update` with `doc`/`upsert` to preserve user reading state
 * - Processes series sequentially to keep Mylar load predictable
 * - Enriches issues concurrently (configurable limit for rate limiting)
 * - Removes undefined values from updates to avoid null overwrites
 *
 * @param options - Sync configuration
 * @returns Statistics about the sync operation
 */
export async function syncMylarToElastic(
  options: MylarToElasticSyncOptions = {}
): Promise<SyncStats> {
  const nowIso = new Date().toISOString();

  // === EXTRACT: Fetch all data from Mylar ===
  const seriesResp = await mylarGetAllSeries();

  if (!seriesResp?.data) {
    throw new Error(`Failed to fetch series from Mylar. Response: ${JSON.stringify(seriesResp)}`);
  }

  const allSeries = seriesResp.data;
  const series = options.seriesLimit ? allSeries.slice(0, options.seriesLimit) : allSeries;

  const historyResp = await mylarGetHistory();

  if (!historyResp?.data) {
    throw new Error(`Failed to fetch history from Mylar. Response: ${JSON.stringify(historyResp)}`);
  }

  const downloadedAtByIssueId = buildDownloadedAtMap(historyResp.data);

  const stats: SyncStats = {
    seriesSeen: allSeries.length,
    seriesSynced: 0,
    issuesUpserted: 0,
    issuesEnriched: 0,
    coversCached: 0,
  };

  // Pre-fetch IDs of issues already enriched with character data so we can skip
  // them during enrichment — avoids re-hitting ComicVine for the full library
  // on every nightly run (5000 issues would exhaust the 200 req/hour limit).
  const alreadyEnrichedIds = new Set<string>();
  if (options.enrichFromComicVine) {
    const enrichedResp = await elastic.search<{ issue_id: string }>({
      index: ISSUES_INDEX,
      size: 10_000,
      _source: ["issue_id"],
      query: { exists: { field: "characters" } },
    });
    for (const hit of enrichedResp.hits.hits) {
      if (hit._source?.issue_id) alreadyEnrichedIds.add(hit._source.issue_id);
    }
  }

  // === TRANSFORM & LOAD: Process each series sequentially ===
  // Sequential processing keeps Mylar load predictable (avoid overwhelming the API)
  for (const seriesEntry of series) {
    // Fetch detailed series info and all its issues
    const seriesDetailResp = await mylarGetSeries(seriesEntry.id);
    const seriesInfo = seriesDetailResp.data.comic[0];
    const issues = seriesDetailResp.data.issues;

    const issueDocs: { id: string; doc: IssueElasticDoc; upsert: IssueElasticUpsert }[] = [];

    for (const issue of issues) {
      let coverUrl: string | undefined = issue.imageURL;
      let thumbHash: string | undefined;
      let issueDescription: string | undefined;
      let comicVineStoreDate: string | undefined;
      let characters: string[] | undefined;

      // Optional: Enrich with ComicVine metadata (better dates, descriptions, characters).
      // Skips issues already enriched to stay within the 200 req/hour API limit.
      // Throttled to 1 request per 20s (~180/hour) to avoid velocity blocks.
      if (options.enrichFromComicVine && !alreadyEnrichedIds.has(issue.id)) {
        const cv = await getComicIssueDetails(issue.id);
        comicVineStoreDate = cv.store_date;
        issueDescription = cv.description;
        // Prefer ComicVine cover for remote, unless we cache local
        coverUrl = cv.image?.original_url ?? coverUrl;
        characters = cv.character_credits.map((c) => c.name);
        stats.issuesEnriched += 1;
        await sleep(20_000);
      }

      // Derive "added to library" timestamp from Mylar history
      const addedToLibraryAt =
        issue.status === "Downloaded"
          ? downloadedAtByIssueId.get(issue.id)
          : undefined;

      // Optional: Cache cover image locally
      if (options.cacheCovers && issue.status === "Downloaded") {
        const cached = await ensureCoverCached(issue.id);
        if (cached) {
          coverUrl = cached;
          stats.coversCached += 1;
          thumbHash = (await generateThumbHash(issue.id)) ?? undefined;
        }
      }

      const issueDate = pickIssueDate(issue, comicVineStoreDate);

      const { doc, upsert } = buildIssueBaseDoc(issue, seriesInfo, {
        nowIso,
        coverUrl,
        thumbHash,
        issueDescription,
        issueDate,
        addedToLibraryAt,
        characters,
      });

      // Remove undefined values to avoid null overwrites in Elasticsearch
      // (undefined fields are not sent, so existing values are preserved)
      for (const [key, value] of Object.entries(doc)) {
        if (value === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (doc as any)[key];
        }
      }

      issueDocs.push({ id: issue.id, doc, upsert });
    }

    // Bulk upsert all issues for this series
    await elasticBulkUpsertDocuments(ISSUES_INDEX, issueDocs, {
      refresh: options.refresh,
    });

    stats.seriesSynced += 1;
    stats.issuesUpserted += issueDocs.length;

    console.info(
      `Synced series ${seriesInfo.id} (${seriesInfo.name}) issues=${issueDocs.length}`
    );
  }

  return stats;
}
