import type { estypes } from "@elastic/elasticsearch";

/**
 * Read model index for series progress.
 */
export const SERIES_PROGRESS_INDEX = "series_progress";

/**
 * Elasticsearch mappings for the `series_progress` index.
 *
 * This is the materialized view that powers the homepage.
 */
export const seriesProgressMappings: estypes.MappingTypeMapping = {
  properties: {
    series_id: { type: "keyword" },
    series_name: {
      type: "text",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    series_year: { type: "keyword" },
    series_publisher: { type: "keyword" },
    series_cover: { type: "keyword" },
    current_issue_id: { type: "keyword" },
    current_issue_number: { type: "integer" },
    next_issue_id: { type: "keyword" },
    next_issue_number: { type: "integer" },
    next_issue_download_status: { type: "keyword" },
    last_read_issue_id: { type: "keyword" },
    last_read_issue_number: { type: "integer" },
    last_activity_at: { type: "date" },
    last_read_at: { type: "date" },
  },
};
