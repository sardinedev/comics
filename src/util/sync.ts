import pThrottle from "p-throttle";
import { getComicIssueDetails, getVolumeDetails } from "./comicvine";
import {
  elasticBulkUpdateSeries,
  elasticBulkUpdateIssues,
  elasticCreateIndex,
  getElasticClient,
  elasticUpdateIssue,
  elasticUpdateSeries,
} from "./elastic";
import { mylarGetAllSeries, mylarGetSeries } from "./mylar";
import type { Series } from "./comics.types";

const throttle = pThrottle({
  limit: 1,
  interval: 1000,
});

const issueThrottle = pThrottle({
  limit: 1,
  interval: 18000, // 1 request every 18 seconds
});

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
    totalSeries = data.length;

    for (const serie of data) {
      console.info(`Adding ${serie.name} (${serie.year}) to Elastic`);
      const { data } = await mylarGetSeries(serie.id);
      const { issues } = data;
      totalIssues = totalIssues + issues.length;
      const series: Series = {
        ...serie,
        issues,
      };

      await elasticUpdateSeries(series);
    }

    return {
      series: totalSeries,
      issues: totalIssues,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

// export async function syncSeriesDataFromComicVine(id: string) {
//   console.log("Syncing series data from Comic Vine", id);
//   const elastic = getElasticClient();
//   const cvData = await getVolumeDetails(id);
//   await elastic.index({
//     index: "series",
//     id,
//     document: cvData,
//   });

//   const issueIDs = cvData.issues.map((issue) => issue.id);

//   const throttledIssues = issueIDs.map((id) =>
//     issueThrottle(() => getComicIssueDetails(id))
//   );
//   const issues = await Promise.all(throttledIssues.map((fn) => fn()));

//   await elasticBulkUpdateIssues(issues);
// }
