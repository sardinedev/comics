import { Client } from "@elastic/elasticsearch";
import type { ComicvineSingleIssueResponse } from "./comicvine.types";
import type { Issue, SeriesProgress } from "./comics.types";
import type { estypes } from "@elastic/elasticsearch";
import {
  ISSUES_INDEX,
  issuesMappings,
} from "./models/issue.model";
import {
  SERIES_PROGRESS_INDEX,
  seriesProgressMappings,
} from "./models/reading.model";

type PaginationProps = {
  page: number;
  size?: number;
  sort: "asc" | "desc";
};

export type ElasticBulkUpdateItem = Partial<Issue> & {
  /** Optional full document used when the target doc doesn't exist yet. */
  upsert?: Issue;
};

let client: Client | null = null;

const ELASTIC_API_KEY =
  import.meta.env.ELASTIC_API_KEY ?? process.env.ELASTIC_API_KEY;
const ELASTIC_URL = "http://192.168.50.190:30003";

/**
 * Get the Elastic client.
 */
export function getElasticClient(): Client {
  if (!client) {
    console.info("Creating new Elastic client");
    client = new Client({
      node: ELASTIC_URL,
      auth: {
        apiKey: ELASTIC_API_KEY,
      },
    });
  }
  return client;
}

/**
 * Create a new index in Elastic.
 */
export async function elasticCreateIndex(
  index: string,
  mappings: estypes.MappingTypeMapping
) {
  const elastic = getElasticClient();
  try {
    const response = await elastic.indices.create({
      mappings,
      index,
    });
    console.info(`Created index ${index}:`, response);
  } catch (error) {
    console.error(`Error creating index ${index}:`, error);
  }
}

async function elasticEnsureIndex(
  index: string,
  mappings: estypes.MappingTypeMapping
): Promise<void> {
  const elastic = getElasticClient();
  const exists = await elastic.indices.exists({ index });
  if (exists) return;
  await elasticCreateIndex(index, mappings);
}

/**
 * Ensures the read-model indices exist with the expected mappings.
 *
 * This does not attempt to migrate existing indices.
 */
export async function elasticEnsureReadModelIndices(): Promise<void> {
  await elasticEnsureIndex(ISSUES_INDEX, issuesMappings);
  await elasticEnsureIndex(SERIES_PROGRESS_INDEX, seriesProgressMappings);
}

async function elasticFetchAllIssuesForSeries(seriesId: string): Promise<Issue[]> {
  const elastic = getElasticClient();
  const all: Issue[] = [];

  let searchAfter: estypes.SortResults | undefined;
  while (true) {
    const resp = await elastic.search<Issue>({
      index: ISSUES_INDEX,
      size: 1000,
      query: {
        term: {
          series_id: seriesId,
        },
      },
      sort: [
        { issue_number: { order: "asc" } },
        { issue_id: { order: "asc" } },
      ],
      ...(searchAfter ? { search_after: searchAfter } : {}),
    });

    const hits = resp.hits.hits;
    const batch = hits.map((h) => h._source).filter((s): s is Issue => !!s);
    all.push(...batch);

    if (hits.length < 1000) break;
    const last = hits[hits.length - 1];
    if (!last?.sort) break;
    searchAfter = last.sort;
  }

  return all;
}

function toMillis(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function pickSeriesCover(issues: Issue[]): string | undefined {
  const byNumber = [...issues].sort((a, b) => a.issue_number - b.issue_number);
  return byNumber[0]?.issue_cover;
}

/**
 * Computes and upserts the per-series progress document.
 *
 * Why this exists:
 * - The homepage needs a fast "Continue reading" query.
 * - Doing that directly on the `issues` index requires multiple scans + grouping.
 * - Instead, we materialize one doc per series in `series_progress`.
 *
 * Inputs:
 * - All issues for a single `series_id` from the `issues` index.
 *
 * Outputs (written to `series_progress`):
 * - `current_*`: the one issue currently being read (if any)
 * - `next_*`: the strict next issue to read after current/last-read
 * - `last_read_*`: the latest fully-read issue
 * - `last_activity_at`: recency signal for ordering the homepage list
 *
 * Key rules / assumptions:
 * - At most one issue per series should be in `issue_reading_state === "reading"`.
 *   We still handle multiple (data drift) by picking the most recently opened.
 * - "Strict next" is based on `issue_number` ordering.
 * - `next_*` can point to a not-downloaded issue; UI can decide how to display that.
 * - Timestamps are optional; when absent we fall back to sensible defaults.
 */
export async function elasticUpsertSeriesProgressForSeries(
  seriesId: string
): Promise<SeriesProgress | null> {
  const elastic = getElasticClient();

  // Fetch every issue for this series so we can derive progress from the full set.
  // We sort by `issue_number` inside the query (and paginate via search_after).
  const issues = await elasticFetchAllIssuesForSeries(seriesId);
  if (issues.length === 0) return null;

  // Use the first issue as the canonical source for series metadata.
  // (All issues in a series should share these values.)
  const first = issues[0];

  // 1) Current issue:
  // Pick the issue in "reading" state (if any). If data drift caused multiple
  // "reading" issues, pick the most recently opened; tie-break by issue_number.
  const readingIssues = issues.filter((i) => i.issue_reading_state === "reading");
  const current = readingIssues
    .slice()
    .sort((a, b) => {
      const aMs = toMillis(a.issue_last_opened_at) ?? -1;
      const bMs = toMillis(b.issue_last_opened_at) ?? -1;
      if (aMs !== bMs) return bMs - aMs;
      return b.issue_number - a.issue_number;
    })[0];

  // 2) Last read:
  // Latest completed issue by issue_number (not by date), since reading order is
  // about the series sequence.
  const readIssues = issues.filter((i) => i.issue_reading_state === "read");
  const lastRead = readIssues
    .slice()
    .sort((a, b) => b.issue_number - a.issue_number)[0];

  // 3) Next issue (strict order):
  // If there is a current issue, "next" starts after it; otherwise it starts after
  // the last fully read issue. We exclude issues already marked read.
  //
  // Note: If you want "next" to include already-reading current issue, leave that
  // to the caller/UI (we keep `current_*` separate on purpose).
  const baseline = current?.issue_number ?? lastRead?.issue_number ?? 0;
  const next = issues
    .filter((i) => i.issue_number > baseline)
    .filter((i) => i.issue_reading_state !== "read")
    .slice()
    .sort((a, b) => a.issue_number - b.issue_number)[0];

  // 4) Activity timestamp for ordering:
  // Prefer "last opened" from the current-reading issue; otherwise use "read at".
  // If neither exists, default to now so the doc has a valid date.
  const lastActivityMs = Math.max(
    toMillis(current?.issue_last_opened_at) ?? -1,
    toMillis(lastRead?.issue_read_at) ?? -1
  );

  // Build the progress doc.
  // This is intentionally denormalized (names, numbers, status) to make the
  // homepage query cheap and avoid extra round-trips.
  const progress: SeriesProgress = {
    series_id: seriesId,
    series_name: first.series_name,
    series_year: first.series_year,
    series_publisher: first.series_publisher,
    series_cover: pickSeriesCover(issues),

    current_issue_id: current?.issue_id,
    current_issue_number: current?.issue_number,

    next_issue_id: next?.issue_id,
    next_issue_number: next?.issue_number,
    next_issue_download_status: next?.issue_status,

    last_read_issue_id: lastRead?.issue_id,
    last_read_issue_number: lastRead?.issue_number,

    last_activity_at:
      lastActivityMs >= 0
        ? new Date(lastActivityMs).toISOString()
        : new Date().toISOString(),
    last_read_at: lastRead?.issue_read_at,
  };

  // Upsert via index() so callers don't need to reason about create vs update.
  // `refresh: true` is convenient for dev flows / immediate homepage reads;
  // if this becomes a performance issue, we can batch and refresh less often.
  await elastic.index({
    index: SERIES_PROGRESS_INDEX,
    id: seriesId,
    document: progress,
    refresh: true,
  });

  return progress;
}

/**
 * Get all series from Elastic.
 * @param options Pagination options.
 * @returns The series and the total number of results.
 */
export async function getAllSeries({
  size = 50,
  page = 1,
  sort = "asc",
}: PaginationProps) {
  const elastic = getElasticClient();
  try {
    const series = await elastic.search<Issue[]>({
      index: ISSUES_INDEX,
      size,
      from: (page - 1) * size,
      query: {
        match: {
          issue_number: 1,
        },
      },
      sort: [
        {
          "series_name.keyword": {
            order: sort,
          },
        },
      ],
    });

    const { hits, total } = series.hits;
    let totalResults: number = 0;
    if (total && typeof total !== "number") {
      totalResults = total.value;
    }
    const result = hits
      .map((s) => s._source)
      .filter((s) => !!s)
      .flat();
    return { result, totalResults };
  } catch (error) {
    console.error("Error fetching all series:", error);
    throw Error("Failed to fetch series from Elastic.");
  }
}

/**
 * Get a single series from Elastic.
 * @param id The ID of the series to fetch.
 * @param options Pagination options.
 * @returns The series and the total number of results.
 */
export async function elasticGetSeries(
  id: string,
  { size = 50, page = 1, sort = "asc" }: PaginationProps
) {
  const elastic = getElasticClient();
  try {
    const series = await elastic.search<Issue[]>({
      index: ISSUES_INDEX,
      size,
      from: (page - 1) * size,
      query: {
        match: {
          series_id: id,
        },
      },
      sort: [
        {
          issue_number: {
            order: sort,
          },
        },
      ],
    });

    const { hits, total } = series.hits;
    let totalResults: number = 0;
    if (total && typeof total !== "number") {
      totalResults = total.value;
    }
    const result = hits
      .map((s) => s._source)
      .filter((s) => !!s)
      .flat();
    return { result, totalResults };
  } catch (error) {
    console.error(`Error fetching series ${id}:`, error);
    throw Error("Failed to fetch series from Elastic.");
  }
}

/**
 * Update an issue in Elastic.
 * @param data The issue data to update.
 * @returns The response from Elastic.
 */
export async function elasticUpdateIssue(data: Issue) {
  const elastic = getElasticClient();
  try {
    const response = await elastic.index({
      index: ISSUES_INDEX,
      id: data.issue_id,
      document: data,
    });
    return response;
  } catch (error) {
    console.error(`Error updating issue ${data.issue_id}:`, error);
  }
}

/**
 * Bulk update issues in Elastic.
 * @param data An array of partial Issue objects to update.
 * @returns The bulk response from Elastic.
 */
export async function elasticBulkUpdate(
  data: ElasticBulkUpdateItem[]
): Promise<estypes.BulkResponse> {
  const elastic = getElasticClient();
  try {
    const invalid = data.filter((issue) => !issue.issue_id);
    if (invalid.length > 0) {
      console.warn(
        `elasticBulkUpdate: skipping ${invalid.length} updates without issue_id`
      );
    }

    const operations = data.flatMap((item) => {
      const { issue_id: issueId, upsert, ...doc } = item;
      if (!issueId) return [];

      return [
        { update: { _index: ISSUES_INDEX, _id: issueId } },
        upsert ? { doc, upsert } : { doc },
      ];
    });

    if (operations.length === 0) {
      return {
        took: 0,
        errors: false,
        items: [],
      };
    }

    const bulkResponse = await elastic.bulk({
      refresh: true,
      operations,
    });

    if (bulkResponse.errors) {
      const erroredItems = bulkResponse.items
        .map((item) => item.update ?? item.index ?? item.create ?? item.delete)
        .filter((action): action is estypes.BulkResponseItem => !!action)
        .filter((action) => !!action.error)
        .map((action) => ({
          id: action._id ?? undefined,
          status: action.status,
          type: action.error?.type,
          reason: action.error?.reason,
        }));

      const sample = erroredItems.slice(0, 8);
      console.error("Elasticsearch bulk update failed", {
        index: ISSUES_INDEX,
        took: bulkResponse.took,
        errors: erroredItems.length,
        sample,
      });

      const first = sample[0];
      const hint =
        first?.type === "index_not_found_exception"
          ? ` (index '${ISSUES_INDEX}' not found)`
          : first?.type === "document_missing_exception"
            ? " (document missing; seed may be required)"
            : "";

      throw new Error(
        `Failed to sync issues to Elastic: ${first?.type ?? "bulk_error"}: ${first?.reason ?? "unknown"}${hint}`
      );
    }

    return bulkResponse;
  } catch (error) {
    console.error("elasticBulkUpdate error:", error);
    throw error instanceof Error
      ? error
      : new Error("Failed to sync issues to Elastic.");
  }
}

/**
 * Get a single issue from Elastic.
 * @param id The ID of the issue to fetch.
 * @returns The issue data.
 */
export async function elasticGetIssue(id: string) {
  const elastic = getElasticClient();
  try {
    const issue = await elastic.get<Issue>({
      index: ISSUES_INDEX,
      id,
    });
    return issue._source;
  } catch (error) {
    console.error(`Error fetching issue ${id}:`, error);
  }
}

/**
 * Get weekly comics from Elastic.
 * @param startOfWeek The start date of the week (YYYY-MM-DD).
 * @param endOfWeek The end date of the week (YYYY-MM-DD).
 * @returns An array of ComicvineSingleIssueResponse objects.
 */
export async function elasticGetWeeklyComics(
  startOfWeek: string,
  endOfWeek: string
) {
  console.log("Fetching weekly issues from Elastic");
  console.log("startOfWeek", startOfWeek);
  console.log("endOfWeek", endOfWeek);
  const elastic = getElasticClient();
  try {
    const issues = await elastic.search<ComicvineSingleIssueResponse[]>({
      index: ISSUES_INDEX,
      query: {
        range: {
          cover_date: {
            gte: startOfWeek,
            lte: endOfWeek,
          },
        },
      },
    });

    const { hits } = issues.hits;
    return hits.map((s) => s._source);
  } catch (error) {
    console.error("Error fetching weekly issues:", error);
    throw new Error("Failed to fetch weekly issues from Elastic.");
  }
}

/**
 * Get the latest issues from Elastic.
 * @returns The 10 latest issues sorted by issue date.
 */
export async function elasticGetLatestIssues() {
  console.log("Fetching latest issues from Elastic");
  const elastic = getElasticClient();
  try {
    const issues = await elastic.search<Issue>({
      index: ISSUES_INDEX,
      size: 10,
      sort: [
        {
          issue_date: {
            order: "desc",
          },
        },
      ],
    });

    const { hits } = issues.hits;
    return hits.map((s) => s._source).filter((s) => !!s);
  } catch (error) {
    console.error("Error fetching latest issues:", error);
    throw new Error("Failed to fetch latest issues from Elastic.");
  }
}

/**
 * Get the next unread issues from Elastic.
 * @param size Number of issues to fetch.
 * @returns The next unread issues sorted by issue date (most recent first).
 */
export async function elasticGetUpNextIssues(size: number = 10) {
  console.log("Fetching up next (unread) issues from Elastic");
  const elastic = getElasticClient();
  try {
    const issues = await elastic.search<Issue>({
      index: ISSUES_INDEX,
      size,
      query: {
        term: {
          issue_reading_state: "unread",
        },
      },
      sort: [
        {
          issue_date: {
            order: "desc",
          },
        },
      ],
    });

    const { hits } = issues.hits;
    return hits.map((s) => s._source).filter((s) => !!s);
  } catch (error) {
    console.error("Error fetching up next issues:", error);
    throw new Error("Failed to fetch up next issues from Elastic.");
  }
}

export async function elasticGetContinueReadingSeriesProgress(
  size: number = 10
): Promise<SeriesProgress[]> {
  const elastic = getElasticClient();

  const resp = await elastic.search<SeriesProgress>({
    index: SERIES_PROGRESS_INDEX,
    size,
    query: {
      bool: {
        should: [
          { exists: { field: "current_issue_id" } },
          { exists: { field: "next_issue_id" } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ last_activity_at: { order: "desc" } }],
  });

  return resp.hits.hits
    .map((h) => h._source)
    .filter((s): s is SeriesProgress => !!s);
}

/**
 * "Continue reading": fetch one issue per active series.
 *
 * Powered by the `series_progress` materialized view.
 */
export async function elasticGetContinueReadingIssues({
  maxSeries = 10,
}: {
  /** Number of series to return */
  maxSeries?: number;
} = {}) {
  const elastic = getElasticClient();

  try {
    console.log("Fetching continue reading issues from series_progress");
    const progress = await elasticGetContinueReadingSeriesProgress(maxSeries);
    if (progress.length === 0) return [];

    const desiredIssueIds = progress
      .map((p) => p.current_issue_id ?? p.next_issue_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const uniqueIds = Array.from(new Set(desiredIssueIds));
    if (uniqueIds.length === 0) return [];

    const mgetResp = await elastic.mget<Issue>({
      index: ISSUES_INDEX,
      ids: uniqueIds,
    });

    const byId = new Map<string, Issue>();
    for (const doc of mgetResp.docs) {
      const issue = (doc as { _id?: string; _source?: Issue })._source;
      const id = (doc as { _id?: string })._id;
      if (issue && id) byId.set(id, issue);
    }

    const ordered: Issue[] = [];
    for (const id of desiredIssueIds) {
      const issue = byId.get(id);
      if (issue) ordered.push(issue);
    }

    return ordered;
  } catch (error) {
    console.error("Error fetching continue reading issues:", error);
    throw new Error("Failed to fetch continue reading issues from Elastic.");
  }
}

/**
 * Adds an issue to Elastic without updating if it already exists.
 * @param data The issue data to add.
 * @returns The response from Elastic or a message if the issue already exists.
 */
export async function elasticAddIssueWithoutUpdate(data: Issue) {
  const elastic = getElasticClient();
  try {
    const response = await elastic.index({
      index: ISSUES_INDEX,
      id: data.issue_id,
      document: data,
      op_type: "create",
    });
    return response;
  } catch (error: any) {
    if (
      error?.meta?.body?.error?.type === "version_conflict_engine_exception"
    ) {
      return {
        result: "skipped",
        message: `${data.series_name} (${data.issue_number}) already exists, skipping.`,
      };
    } else {
      console.error(`Error adding issue ${data.issue_id}:`, error);
      throw error;
    }
  }
}
