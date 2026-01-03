import type { APIRoute } from "astro";
import { getElasticClient } from "@util/elastic";
import { extractCoverFromDownloadedIssue, coverExists, getCoverUrl } from "@util/covers";
import type { Issue } from "@util/comics.types";

const ELASTIC_INDEX = import.meta.env.ELASTIC_INDEX ?? "issues";

type BackfillError = {
  issue_id: string;
  issue_cover: string | undefined;
  issue_status: string | undefined;
  reason: string;
};

type BackfillStats = {
  processed: number;
  cached: number;
  skipped_existing: number;
  skipped_not_downloaded: number;
  failed: number;
};

/**
 * Backfills missing cover images for downloaded issues in Elasticsearch.
 * Only processes issues with status "Downloaded" - extracts covers from CBZ files via Mylar.
 * Non-downloaded issues use ComicVine URLs (browser fetches directly).
 *
 * Query params:
 * - limit: Max issues to process (default: 100)
 * - force: Re-download even if file exists (default: false)
 */
export const POST: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const force = url.searchParams.get("force") === "true";

  const elastic = getElasticClient();

  const stats: BackfillStats = {
    processed: 0,
    cached: 0,
    skipped_existing: 0,
    skipped_not_downloaded: 0,
    failed: 0,
  };
  const errors: BackfillError[] = [];

  try {
    // Fetch downloaded issues only for backfill
    const response = await elastic.search<Issue>({
      index: ELASTIC_INDEX,
      size: Math.min(limit * 2, 2000), // Fetch extra to account for skipped
      _source: ["issue_id", "issue_cover", "issue_status"],
      query: {
        bool: {
          filter: [{ match: { issue_status: "Downloaded" } }],
        },
      },
      sort: [{ issue_date: "desc" }],
    });

    const issues = response.hits.hits
      .map((hit) => hit._source)
      .filter((issue): issue is Issue => !!issue);

    for (const issue of issues) {
      if (stats.processed >= limit) break;

      const { issue_id, issue_cover, issue_status } = issue;

      // Skip non-downloaded issues (they use ComicVine URLs)
      if (issue_status !== "Downloaded") {
        stats.skipped_not_downloaded++;
        continue;
      }

      stats.processed++;

      // Skip if already cached (unless force=true)
      if (!force && (await coverExists(issue_id))) {
        stats.skipped_existing++;
        continue;
      }

      // Extract cover from CBZ via Mylar
      const result = await extractCoverFromDownloadedIssue(issue_id);

      if (result.success) {
        stats.cached++;
        console.info(`Cached cover for issue ${issue_id} (source: ${result.source})`);

        // Update Elasticsearch if the cover URL changed
        const newCoverUrl = getCoverUrl(issue_id);
        if (issue_cover !== newCoverUrl) {
          try {
            await elastic.update({
              index: ELASTIC_INDEX,
              id: issue_id,
              doc: { issue_cover: newCoverUrl },
            });
          } catch (updateError) {
            console.error(`Failed to update ES for ${issue_id}:`, updateError);
          }
        }
      } else {
        stats.failed++;
        errors.push({
          issue_id,
          issue_cover,
          issue_status,
          reason: result.reason,
        });
        console.warn(`Failed to cache cover for issue ${issue_id}: ${result.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...stats,
        errors: errors.slice(0, 20), // Return first 20 detailed errors
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Backfill error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/**
 * GET endpoint to check backfill status
 * Shows breakdown of:
 * - downloaded issues with cached covers
 * - downloaded issues missing covers
 * - non-downloaded issues (use ComicVine)
 */
export const GET: APIRoute = async () => {
  const elastic = getElasticClient();

  try {
    const response = await elastic.search<Issue>({
      index: ELASTIC_INDEX,
      size: 10000,
      _source: ["issue_id", "issue_cover", "issue_status"],
      query: {
        match_all: {},
      },
    });

    const issues = response.hits.hits
      .map((hit) => hit._source)
      .filter((issue): issue is Issue => !!issue);

    let total = 0;
    let downloaded = 0;
    let downloaded_cached = 0;
    let downloaded_missing = 0;
    let not_downloaded = 0;

    for (const issue of issues) {
      total++;
      
      if (issue.issue_status === "Downloaded") {
        downloaded++;
        if (await coverExists(issue.issue_id)) {
          downloaded_cached++;
        } else {
          downloaded_missing++;
        }
      } else {
        not_downloaded++;
      }
    }

    return new Response(
      JSON.stringify({
        total,
        downloaded: {
          total: downloaded,
          cached: downloaded_cached,
          missing: downloaded_missing,
          percent_cached: downloaded > 0 ? Math.round((downloaded_cached / downloaded) * 100) : 0,
        },
        not_downloaded: {
          total: not_downloaded,
          note: "Using ComicVine URLs (browser fetches directly)",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Status check error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
