import type { estypes } from "@elastic/elasticsearch";

/**
 * Read model index for story arcs.
 */
export const STORY_ARCS_INDEX = "story_arcs";

/**
 * Elasticsearch mappings for the `story_arcs` index.
 *
 * Story arcs are independent entities that can span multiple series.
 * Each arc contains a nested array of issues with their reading order.
 *
 * This index enables:
 * - Browse all story arcs independently
 * - Track reading progress across arcs
 * - Show issues in arc reading order
 * - Cross-series arc support
 */
export const storyArcsMappings: estypes.MappingTypeMapping = {
  properties: {
    // === IDENTITY ===
    arc_id: { type: "keyword" },

    // === ARC DETAILS ===
    arc_name: {
      type: "text",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    arc_description: { type: "text" },
    arc_publisher: { type: "keyword" }, // Primary publisher
    arc_cover_url: { type: "keyword" },

    // === ISSUES IN ARC ===
    issues: {
      type: "nested",
      properties: {
        issue_id: { type: "keyword" },
        series_id: { type: "keyword" },
        series_name: { type: "keyword" },
        issue_number: { type: "float" },
        position_in_arc: { type: "integer" }, // Reading order within arc
        release_date: { type: "date" },
      },
    },

    total_issues_in_arc: { type: "integer" },

    // === METADATA ===
    synced_at: { type: "date" }, // Last sync from ComicVine
  },
};
