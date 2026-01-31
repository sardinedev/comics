import type { estypes } from "@elastic/elasticsearch";

/**
 * Read model index for issues.
 */
export const ISSUES_INDEX = "issues";

/**
 * Elasticsearch mappings for the `issues` index.
 *
 * This index stores all comic issues with:
 * - Denormalized series metadata (fast queries, no joins)
 * - Single-user reading state and progress
 * - Story arc references
 * - Full creator information
 * - Mylar download status and file location
 *
 * Reading states: unread | reading | read
 * Download statuses: Wanted | Skipped | Downloaded | Snatched | Archived | Ignored | Failed
 */
export const issuesMappings: estypes.MappingTypeMapping = {
  properties: {
    // === IDENTITY ===
    issue_id: { type: "keyword" },
    series_id: { type: "keyword" },

    // === ISSUE DETAILS ===
    issue_number: { type: "float" }, // Supports 1, 1.1, 2.5 etc.
    issue_name: {
      type: "text",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    issue_description: { type: "text" },
    issue_date: { type: "date" }, // ComicVine release date
    issue_cover_url: { type: "keyword" },
    issue_page_count: { type: "integer" },

    // === CREATORS ===
    writers: { type: "keyword" },
    artists: { type: "keyword" },
    colorists: { type: "keyword" },
    letterers: { type: "keyword" },
    cover_artists: { type: "keyword" },
    editors: { type: "keyword" },

    // === SERIES DATA (denormalized from ComicVine) ===
    series_name: {
      type: "text",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    series_description: { type: "text" },
    series_year: { type: "keyword" },
    series_publisher: { type: "keyword" },
    series_cover_url: { type: "keyword" },
    series_total_issues: { type: "integer" },
    series_status: { type: "keyword" }, // ongoing | completed | cancelled

    // === STORY ARCS (references to story_arcs index) ===
    story_arc_ids: { type: "keyword" }, // Array of arc IDs this issue belongs to

    // === MYLAR STATUS ===
    download_status: { type: "keyword" },
    mylar_file_location: { type: "keyword" },
    added_to_library_at: { type: "date" }, // When status became "Downloaded"

    // === READING STATE (single user) ===
    reading_state: { type: "keyword" }, // unread | reading | read
    started_reading_at: { type: "date" }, // First opened or marked as reading
    last_opened_at: { type: "date" }, // Most recent access
    completed_at: { type: "date" }, // When marked as read
    current_page: { type: "integer" }, // Resume reading from this page
    is_favorite: { type: "boolean" },
    user_rating: { type: "float" }, // 1-5 stars

    // === METADATA ===
    synced_at: { type: "date" }, // Last sync from Mylar/ComicVine
  },
};
