import {
  elasticAddIssueWithoutUpdate,
  elasticCreateIndex,
  elasticUpdateIssue,
} from "./elastic";
import { mylarGetAllSeries, mylarGetSeries } from "./mylar";
import { formatMylarIssue } from "./formatter";
import { ensureCoverCached } from "./covers";

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
  issueStatus: string,
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
 * Syncs Mylar comics to Elastic without updating existing issues.
 */
export async function syncMylarWithElastic() {
  let totalIssues = 0;
  const errors: string[] = [];
  try {
    const { data } = await mylarGetAllSeries();

    for (const serie of data) {
      try {
        const { data } = await mylarGetSeries(serie.id);
        const { issues } = data;
        for (const issue of issues) {
          const formatedIssue = formatMylarIssue(issue, serie);

          await applyLocalCoverIfDownloaded(formatedIssue, issue.id, issue.status, serie.id);

          try {
            const update = await elasticAddIssueWithoutUpdate(formatedIssue);
            if (update.result === "skipped") {
              continue;
            } else {
              console.info(`Adding ${serie.name} (${issue.number}) to Elastic`);
              totalIssues = totalIssues + 1;
            }
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
      issues: totalIssues,
      errors,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}
