import {
  elasticCreateIndex,
  elasticUpdateIssue,
  elasticBulkUpdate,
} from "./elastic";
import { mylarGetAllSeries, mylarGetSeries, mylarGetHistory } from "./mylar";
import { formatMylarIssue } from "./formatter";
import { ensureCoverCached } from "./covers";
import type { Issue } from "./comics.types";
import type { IssueStatus } from "./mylar.types";

/**
 * If the issue is downloaded, attempts to set its cover to the local cached cover URL.
 * @param formattedIssue The formatted issue object to potentially modify.
 * @param issueId The unique identifier of the issue.
 * @param issueStatus The download status of the issue.
 * @param seriesId (Optional) The unique identifier of the series.
 * @return A promise that resolves when the operation is complete.
 */
async function applyLocalCoverIfDownloaded(
  formattedIssue: { issue_cover: string },
  issueId: string,
  issueStatus: IssueStatus,
  seriesId?: string
): Promise<void> {
  if (issueStatus !== "Downloaded") return;

  const localCoverUrl = await ensureCoverCached(issueId, seriesId);
  if (localCoverUrl) {
    formattedIssue.issue_cover = localCoverUrl;
  }
}

/*
 * Seeds elasticsearch database.
 * 1- Fetches series data from Mylar.
 * 2- Fetches series data from Comic Vine.
 * 3- Bulk updates the series data in elasticsearch.
 * 4- Fetches issue data from Comic Vine for each issue in the series.
 * 5- Bulk updates the issue data in elasticsearch.
 */
export async function seedElastic() {
  let totalSeries = 0;
  let totalIssues = 0;
  const errors: string[] = [];
  try {
    try {
      await elasticCreateIndex("comics", {
        properties: {
          year: {
            type: "date",
            format: "yyyy",
          },
        },
      });
    } catch (error) {
      console.error(error);
      console.log("Index already exists.");
    }

    const { data } = await mylarGetAllSeries();

    for (const serie of data) {
      try {
        const { data } = await mylarGetSeries(serie.id);
        const { issues } = data;
        for (const issue of issues) {
          console.info(`Adding ${serie.name} (${issue.number}) to Elastic`);
          const formatedIssue = formatMylarIssue(issue, serie);

          await applyLocalCoverIfDownloaded(formatedIssue, issue.id, issue.status, serie.id);

          try {
            await elasticUpdateIssue(formatedIssue);
            totalIssues = totalIssues + 1;
          } catch (error) {
            console.error(error);
            errors.push(`Failed to update ${issue.name} issue in Elastic.`);
          }
        }
      } catch (error) {
        console.error(error);
        errors.push(`Failed to fetch ${serie.name} series data from Mylar.`);
      }
    }

    return {
      series: totalSeries,
      issues: totalIssues,
      errors,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

/*
 * Syncs recently updated issues from Mylar history to Elastic.
 * Uses getHistory to only sync issues that have been recently snatched/downloaded.
 */
export async function syncMylarWithElastic() {
  let totalIssues = 0;
  const errors: string[] = [];
  
  try {
    const { data: historyItems } = await mylarGetHistory();
    
    if (!historyItems || historyItems.length === 0) {
      console.info("No history items to sync");
      return { issues: 0, errors: [] };
    }

    // Filter to only successfully processed issues and deduplicate
    // (history has multiple entries per issue: Snatched, Post-Processed, etc.)
    const processedIssues = new Map<string, typeof historyItems[0]>();
    for (const item of historyItems) {
      if (item.Status === "Post-Processed" || item.Status === "Downloaded") {
        // Keep the most recent entry per issue
        if (!processedIssues.has(item.IssueID)) {
          processedIssues.set(item.IssueID, item);
        }
      }
    }

    if (processedIssues.size === 0) {
      console.info("No processed issues to sync");
      return { issues: 0, errors: [] };
    }

    // Group by series to minimize API calls.
    // Mylar history rows only give us ComicID + IssueID, but to format/update an issue
    // we need the full issue payload which we can only fetch via `getComic&id=<ComicID>`.
    // Fetching per history item would repeat the same series request many times.
    const seriesMap = new Map<string, Set<string>>();
    for (const item of processedIssues.values()) {
      if (!seriesMap.has(item.ComicID)) {
        seriesMap.set(item.ComicID, new Set());
      }
      seriesMap.get(item.ComicID)?.add(item.IssueID);
    }

    const updatesToApply: (Partial<Issue> & { upsert?: Issue })[] = [];

    for (const [seriesId, issueIds] of seriesMap.entries()) {
      try {
        const { data } = await mylarGetSeries(seriesId);
        const { comic, issues } = data;
        const serie = comic[0];

        // Filter to only the issues in history
        const recentIssues = issues.filter((issue) => issueIds.has(issue.id));

        for (const issue of recentIssues) {
          const formattedIssue = formatMylarIssue(issue, serie);

          await applyLocalCoverIfDownloaded(formattedIssue, issue.id, issue.status, serie.id);

          updatesToApply.push({
            issue_id: formattedIssue.issue_id,
            issue_cover: formattedIssue.issue_cover,
            issue_status: formattedIssue.issue_status,
            upsert: formattedIssue,
          });

          totalIssues++;
        }
      } catch (error) {
        console.error(`Failed to fetch series ${seriesId}:`, error);
        errors.push(`Failed to fetch series data for ComicID ${seriesId}.`);
      }
    }

    // Bulk update all changes at once
    if (updatesToApply.length > 0) {
      try {
        await elasticBulkUpdate(updatesToApply);
        console.info(`Synced ${updatesToApply.length} issues from Mylar history`);
      } catch (error) {
        console.error("Failed to bulk update Elastic:", error);
        errors.push(
          error instanceof Error
            ? error.message
            : "Failed to bulk update issues in Elastic."
        );
      }
    }

    return {
      issues: totalIssues,
      errors,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync history to Elastic.");
  }
}
