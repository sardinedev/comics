import { Client } from "@elastic/elasticsearch";
import type { ComicvineSingleIssueResponse } from "./comicvine.types";
import type { Issue } from "./comics.types";
import type { estypes } from "@elastic/elasticsearch";

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

const ELASTIC_INDEX = "issues";
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
      index: ELASTIC_INDEX,
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
      index: ELASTIC_INDEX,
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
      index: ELASTIC_INDEX,
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
        { update: { _index: ELASTIC_INDEX, _id: issueId } },
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
        index: ELASTIC_INDEX,
        took: bulkResponse.took,
        errors: erroredItems.length,
        sample,
      });

      const first = sample[0];
      const hint =
        first?.type === "index_not_found_exception"
          ? ` (index '${ELASTIC_INDEX}' not found)`
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
      index: ELASTIC_INDEX,
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
      index: ELASTIC_INDEX,
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
      index: ELASTIC_INDEX,
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
      index: ELASTIC_INDEX,
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

/**
 * "Continue reading": fetch the next unread issue per series that is currently being read.
 *
 * Elastic doesn't have a dedicated endpoint for this, so we query a bounded set of candidate
 * issues and pick the lowest `issue_number` per `series_id`.
 */
export async function elasticGetContinueReadingIssues({
  maxSeries = 10,
  scanRead = 500,
  scanUnread = 500,
  maxCandidateSeries = 50,
}: {
  /** Number of series to return */
  maxSeries?: number;
  /** How many read issues to scan to infer "currently reading" series */
  scanRead?: number;
  /** How many unread issues to scan to pick the next issue per series */
  scanUnread?: number;
  /** Cap the number of candidate series IDs we consider */
  maxCandidateSeries?: number;
} = {}) {
  console.log("Fetching continue reading issues from Elastic");
  const elastic = getElasticClient();

  try {
    // 1) Infer "currently reading" series from recently read issues.
    const readIssues = await elastic.search<Issue>({
      index: ELASTIC_INDEX,
      size: scanRead,
      query: {
        term: {
          issue_reading_state: "read",
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

    const maxReadIssueNumberBySeries = new Map<string, number>();
    const candidateSeriesIds: string[] = [];
    const candidateSeriesIdSet = new Set<string>();

    for (const hit of readIssues.hits.hits) {
      const issue = hit._source;
      if (!issue) continue;

      const prevMax = maxReadIssueNumberBySeries.get(issue.series_id);
      if (prevMax === undefined || issue.issue_number > prevMax) {
        maxReadIssueNumberBySeries.set(issue.series_id, issue.issue_number);
      }

      if (!candidateSeriesIdSet.has(issue.series_id)) {
        candidateSeriesIds.push(issue.series_id);
        candidateSeriesIdSet.add(issue.series_id);
        if (candidateSeriesIds.length >= maxCandidateSeries) break;
      }
    }

    if (candidateSeriesIds.length === 0) return [];

    // 2) Fetch unread issues for those series and choose the "next" one.
    const unreadIssues = await elastic.search<Issue>({
      index: ELASTIC_INDEX,
      size: scanUnread,
      query: {
        bool: {
          filter: [
            {
              terms: {
                series_id: candidateSeriesIds,
              },
            },
            {
              term: {
                issue_reading_state: "unread",
              },
            },
          ],
        },
      },
      sort: [
        {
          "series_name.keyword": {
            order: "asc",
          },
        },
        {
          issue_number: {
            order: "asc",
          },
        },
      ],
    });

    const chosenBySeries = new Map<string, Issue>();
    const firstUnreadBySeries = new Map<string, Issue>();

    for (const hit of unreadIssues.hits.hits) {
      const issue = hit._source;
      if (!issue) continue;

      if (!firstUnreadBySeries.has(issue.series_id)) {
        firstUnreadBySeries.set(issue.series_id, issue);
      }

      if (chosenBySeries.has(issue.series_id)) continue;

      const maxRead = maxReadIssueNumberBySeries.get(issue.series_id);
      if (maxRead === undefined) continue;

      if (issue.issue_number > maxRead) {
        chosenBySeries.set(issue.series_id, issue);
      }
    }

    // Fallback: if we didn't find an unread issue after the max read, take the earliest unread.
    for (const [seriesId, issue] of firstUnreadBySeries.entries()) {
      if (!chosenBySeries.has(seriesId)) {
        chosenBySeries.set(seriesId, issue);
      }
    }

    return Array.from(chosenBySeries.values()).slice(0, maxSeries);
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
      index: ELASTIC_INDEX,
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
