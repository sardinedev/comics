import { Client } from "@elastic/elasticsearch";
import type { estypes } from "@elastic/elasticsearch";
import { env } from "@lib/env";

const ELASTIC_API_KEY = env("ELASTIC_API_KEY");
const ELASTIC_URL = env("ELASTIC_URL") ?? "http://192.168.50.190:30003";

if (!ELASTIC_API_KEY) {
  throw new Error(
    "ELASTIC_API_KEY is not defined. Please set it in your environment variables."
  );
}

export const elastic: Client = new Client({
  node: ELASTIC_URL,
  auth: {
    apiKey: ELASTIC_API_KEY,
  },
});

/**
 * Check if an index exists in Elasticsearch.
 * Throws if there's a connection error.
 */
export function elasticIndexExists(index: string): Promise<boolean> {
  return elastic.indices.exists({ index });
}

/**
 * Default index settings optimized for single-node development.
 */
export const DEFAULT_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0, // 0 replicas for single-node (avoids yellow health)
  refresh_interval: "1s", // Default refresh interval
};

/**
 * Create a new index in Elastic with sensible defaults.
 */
export async function elasticCreateIndex(
  index: string,
  mappings: estypes.MappingTypeMapping,
  settings: estypes.IndicesIndexSettings = DEFAULT_INDEX_SETTINGS
) {
  try {
    const response = await elastic.indices.create({
      index,
      mappings,
      settings,
    });

    if (!response.acknowledged) {
      throw new Error(`Failed to create index ${index}`);
    }

    console.info(`Created index ${index}:`, response);
  } catch (error) {
    console.error(`Error creating index ${index}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Error creating index ${index}`);
  }
}

/**
 * Update index mappings (adds new fields, doesn't remove existing ones).
 */
export async function elasticUpdateMappings(
  index: string,
  mappings: estypes.MappingTypeMapping
) {
  try {
    const response = await elastic.indices.putMapping({
      index,
      properties: mappings.properties,
    });

    if (!response.acknowledged) {
      throw new Error(`Failed to update mappings for index ${index}`);
    }

    console.info(`Updated mappings for index ${index}:`, response);
  } catch (error) {
    console.error(`Error updating mappings for index ${index}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Error updating mappings for index ${index}`);
  }
}

/**
 * Delete an index from Elasticsearch.
 */
export async function elasticDeleteIndex(index: string) {
  try {
    const response = await elastic.indices.delete({ index });

    if (!response.acknowledged) {
      throw new Error(`Failed to delete index ${index}`);
    }

    console.info(`Deleted index ${index}:`, response);
  } catch (error) {
    console.error(`Error deleting index ${index}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Error deleting index ${index}`);
  }
}

/**
 * Initialize or update an index with mappings.
 * If the index doesn't exist, creates it.
 * If it exists, updates the mappings (additive only).
 */
export async function elasticInitializeIndex(
  index: string,
  mappings: estypes.MappingTypeMapping,
  settings?: estypes.IndicesIndexSettings
) {
  const exists = await elasticIndexExists(index);

  if (exists) {
    console.info(`Index ${index} exists, updating mappings...`);
    await elasticUpdateMappings(index, mappings);
  } else {
    console.info(`Index ${index} does not exist, creating...`);
    await elasticCreateIndex(index, mappings, settings);
  }
}

// Re-export reindex functionality
export { elasticReindex } from "./reindex";

// Re-export document/bulk helpers
export { summarizeBulkResponse, elasticBulkUpsertDocuments } from "./documents";


