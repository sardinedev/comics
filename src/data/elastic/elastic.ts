import { Client } from "@elastic/elasticsearch";
import type { estypes } from "@elastic/elasticsearch";

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
    throw error instanceof Error
      ? error
      : new Error(`Error creating index ${index}`);
  }
}

