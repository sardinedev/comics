import { Client } from "@elastic/elasticsearch";
import type {
  ComicvineSingleIssueResponse,
  ComicvineVolume,
} from "./comicvine.types";
import type { MappingTypeMapping } from "@elastic/elasticsearch/lib/api/types";
import type { Issue } from "./comics.types";

type PaginationProps = {
  page: number;
  size?: number;
  sort: "asc" | "desc";
};

let client: Client | null = null;

export const ELASTIC_INDEX = "issues";
export const ELASTIC_API_KEY =
  "UzZvR2ZwTUJaalpTOW81VTJteVY6N3VEMGVId3RUNjJGcFE3RFNmOE9sdw==";

/**
 * Get the Elastic client.
 */
export function getElasticClient(): Client {
  if (!client) {
    console.info("Creating new Elastic client");
    client = new Client({
      node: "http://192.168.50.190:30003",
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
  mappings?: MappingTypeMapping
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
