import type { estypes } from "@elastic/elasticsearch";

/**
 * Read model index for issues.
 */
export const ISSUES_INDEX = "issues";

/**
 * Elasticsearch mappings for the `issues` index.
 *
 * Notes:
 * - `series_name` gets a `.keyword` subfield for sorting.
 * - `issue_reading_state` is a keyword enum: unread | reading | read
 */
export const issuesMappings: estypes.MappingTypeMapping = {
  properties: {
    issue_id: { type: "keyword" },
    series_id: { type: "keyword" },
    series_name: {
      type: "text",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    issue_number: { type: "integer" },
    issue_name: { type: "text" },
    issue_date: { type: "date" },
    issue_cover: { type: "keyword" },
    issue_artists: { type: "keyword" },
    issue_writers: { type: "keyword" },
    issue_cover_author: { type: "keyword" },
    issue_status: { type: "keyword" },
    issue_reading_state: { type: "keyword" },
    issue_last_opened_at: { type: "date" },
    issue_read_at: { type: "date" },
    series_year: { type: "keyword" },
    series_publisher: { type: "keyword" },
  },
};
