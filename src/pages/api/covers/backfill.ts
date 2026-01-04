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
  const dry = url.searchParams.get("dry") === "true";

  const elastic = getElasticClient();

  const stats: BackfillStats = {
    processed: 0,
    cached: 0,
    skipped_existing: 0,
    skipped_not_downloaded: 0,
    failed: 0,
  };
  const errors: BackfillError[] = [];

  let wouldUpdateExisting = 0;
  let wouldExtract = 0;
  const sampleIssueIds: string[] = [];

  try {
    // Fetch downloaded issues that still point at remote covers.
    // This makes the candidate set shrink over time as we update ES to /covers/*.
    const response = await elastic.search<Issue>({
      index: ELASTIC_INDEX,
      size: Math.min(limit, 2000),
      _source: ["issue_id", "issue_cover", "issue_status"],
      query: {
        bool: {
          filter: [
            { match: { issue_status: "Downloaded" } },
            {
              bool: {
                should: [
                  { prefix: { "issue_cover.keyword": "http" } },
                  { prefix: { issue_cover: "http" } },
                ],
                minimum_should_match: 1,
              },
            },
          ],
        },
      },
      sort: [{ issue_date: "desc" }],
    });

    const issues = response.hits.hits
      .map((hit) => hit._source)
      .filter((issue): issue is Issue => !!issue);

    for (const issue of issues) {
      if (stats.processed >= limit) break;

      const {
        issue_id: issueId,
        issue_cover: issueCover,
        issue_status: issueStatus,
      } = issue;

      // Skip non-downloaded issues (they use ComicVine URLs)
      if (issueStatus !== "Downloaded") {
        stats.skipped_not_downloaded++;
        continue;
      }

      stats.processed++;

      if (dry) {
        if (sampleIssueIds.length < 20) sampleIssueIds.push(issueId);

        if (!force && (await coverExists(issueId))) {
          wouldUpdateExisting++;
        } else {
          wouldExtract++;
        }

        continue;
      }

      // If already cached on disk and force=false, just update ES to point at the local cover.
      if (!force && (await coverExists(issueId))) {
        stats.skipped_existing++;
        const newCoverUrl = getCoverUrl(issueId);
        if (issueCover !== newCoverUrl) {
          try {
            await elastic.update({
              index: ELASTIC_INDEX,
              id: issueId,
              doc: { issue_cover: newCoverUrl },
            });
          } catch (updateError) {
            console.error(`Failed to update ES for ${issueId}:`, updateError);
          }
        }

        stats.cached++;
        continue;
      }

      // Extract cover from CBZ via Mylar
      const result = await extractCoverFromDownloadedIssue(issueId);

      if (result.success) {
        stats.cached++;
        console.info(`Cached cover for issue ${issueId} (source: ${result.source})`);

        // Update Elasticsearch if the cover URL changed
        const newCoverUrl = getCoverUrl(issueId);
        if (issueCover !== newCoverUrl) {
          try {
            await elastic.update({
              index: ELASTIC_INDEX,
              id: issueId,
              doc: { issue_cover: newCoverUrl },
            });
          } catch (updateError) {
            console.error(`Failed to update ES for ${issueId}:`, updateError);
          }
        }
      } else {
        stats.failed++;
        errors.push({
          issue_id: issueId,
          issue_cover: issueCover,
          issue_status: issueStatus,
          reason: result.reason,
        });
        console.warn(`Failed to cache cover for issue ${issueId}: ${result.reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry,
        candidates: issues.length,
        would_update_existing: dry ? wouldUpdateExisting : undefined,
        would_extract: dry ? wouldExtract : undefined,
        sample_issue_ids: dry ? sampleIssueIds : undefined,
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
    let downloadedCached = 0;
    let downloadedMissing = 0;
    let notDownloaded = 0;

    for (const issue of issues) {
      total++;

      if (issue.issue_status === "Downloaded") {
        downloaded++;
        if (await coverExists(issue.issue_id)) {
          downloadedCached++;
        } else {
          downloadedMissing++;
        }
      } else {
        notDownloaded++;
      }
    }

    return new Response(
      JSON.stringify({
        total,
        downloaded: {
          total: downloaded,
          cached: downloadedCached,
          missing: downloadedMissing,
          percent_cached: downloaded > 0 ? Math.round((downloadedCached / downloaded) * 100) : 0,
        },
        not_downloaded: {
          total: notDownloaded,
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
