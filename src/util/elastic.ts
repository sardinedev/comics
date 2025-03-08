import { Client } from "@elastic/elasticsearch";
import type { ComicvineSingleIssueResponse } from "./comicvine.types";
import type { Issue } from "./comics.types";
import type { estypes } from "@elastic/elasticsearch";

type PaginationProps = {
  page: number;
  size?: number;
  sort: "asc" | "desc";
};

let client: Client | null = null;

const ELASTIC_INDEX = import.meta.env.ELASTIC_INDEX;
const ELASTIC_API_KEY =
  import.meta.env.ELASTIC_API_KEY ?? process.env.ELASTIC_API_KEY;
const ELASTIC_URL = import.meta.env.ELASTIC_URL;

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

export async function elasticBulkUpdate(data: Partial<Issue>[]) {
  const elastic = getElasticClient();
  try {
    const operations = data.flatMap((issue) => [
      { update: { _index: ELASTIC_INDEX, _id: issue.issue_id } },
      { doc: issue },
    ]);

    const bulkResponse = await elastic.bulk({
      refresh: true,
      operations,
    });

    if (bulkResponse.errors) {
      console.error(bulkResponse);
      throw new Error("Failed to sync issues to Elastic.");
    }

    return bulkResponse;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync issues to Elastic.");
  }
}

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
