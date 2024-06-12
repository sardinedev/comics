import { Client } from "@elastic/elasticsearch";
import { syncMylarSeries } from "./sync";
import type {
  ComicvineSingleIssueResponse,
  ComicvineVolumeResponse,
} from "./comicvine.types";

let client: Client | null = null;

export function getElasticClient(): Client {
  if (!client) {
    console.info("Creating new Elastic client");
    client = new Client({
      node: "http://elasticsearch:9200",
      // auth: {
      //   apiKey: elasticSecrets.ELASTIC_SEARCH_API_KEY,
      // },
    });
  }
  return client;
}

export type SeriesProps = {};
export async function getAllSeries(props?: SeriesProps) {
  const elastic = getElasticClient();
  try {
    const series = await elastic.search({
      index: "series",
      _source: true,
      size: 10000,
    });

    const { hits } = series.hits;
    return hits.map((s: any) => s._source);
  } catch (error) {
    if (error.meta.statusCode === 404) {
      console.info("Index not found, creating index");
      const update = await syncMylarSeries();
      return update.items;
    }
  }
}

export async function elasticGetSeries(id: string) {
  const elastic = getElasticClient();
  try {
    const series = await elastic.get<ComicvineVolumeResponse>({
      index: "series",
      id,
    });
    return series._source;
  } catch (error) {
    console.error(`Error fetching series ${id}:`, error);
  }
}

export async function elasticUpdateSeries(data: ComicvineVolumeResponse) {
  const elastic = getElasticClient();
  try {
    const response = await elastic.index({
      index: "series",
      id: data.id.toString(),
      document: data,
    });
    return response;
  } catch (error) {
    console.error(`Error updating series ${data.id}:`, error);
  }
}

export async function elasticBulkUpdateSeries(data: ComicvineVolumeResponse[]) {
  const elastic = getElasticClient();
  try {
    const operations = data.flatMap((serie) => [
      { index: { _index: "series", _id: serie.id } },
      serie,
    ]);

    const bulkResponse = await elastic.bulk({
      refresh: true,
      body: operations,
    });

    if (bulkResponse.errors) {
      console.error(bulkResponse);
      throw new Error("Failed to sync series to Elastic.");
    }

    return bulkResponse;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

export async function elasticUpdateIssue(data: ComicvineSingleIssueResponse) {
  const elastic = getElasticClient();
  try {
    const response = await elastic.index({
      index: "issues",
      id: data.id.toString(),
      document: data,
    });
    return response;
  } catch (error) {
    console.error(`Error updating issue ${data.id}:`, error);
  }
}

export async function elasticBulkUpdateIssues(
  data: ComicvineSingleIssueResponse[]
) {
  const elastic = getElasticClient();
  try {
    const operations = data.flatMap((issue) => [
      { index: { _index: "issues", _id: issue.id } },
      issue,
    ]);

    const bulkResponse = await elastic.bulk({
      refresh: true,
      body: operations,
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

export async function elasticGetComicIssue(id: string) {
  const elastic = getElasticClient();
  try {
    const issue = await elastic.get<ComicvineSingleIssueResponse>({
      index: "issues",
      id,
    });
    return issue._source;
  } catch (error) {
    console.error(`Error fetching issue ${id}:`, error);
  }
}
