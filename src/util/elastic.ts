import { Client } from "@elastic/elasticsearch";
import { syncMylarSeries } from "./sync";

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
