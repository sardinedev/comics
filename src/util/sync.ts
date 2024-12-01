import { getComicIssueDetails, getVolumeDetails } from "./comicvine";
import {
  elasticCreateIndex,
  elasticUpdateIssue,
  elasticUpdateSeries,
} from "./elastic";
import { mylarGetAllSeries, mylarGetSeries } from "./mylar";
import { formatMylarIssue, formatMylarSeries } from "./formatter";
import type { Series } from "./comics.types";

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
          console.info(`Adding ${issue.name} (${issue.number}) to Elastic`);
          const formatedIssue = formatMylarIssue(issue, serie);
          try {
            await elasticUpdateIssue(formatedIssue);
            totalIssues = totalIssues + 1;
          } catch (error) {
            console.error(error);
            errors.push(`Failed to update ${issue.name} issue in Elastic.`);
          }
        }
        // const formatedIssues = issues.map((issue) => formatMylarIssue(issue));

        // try {
        //   await elasticUpdateSeries(series);
        //   totalIssues = totalIssues + issues.length;
        //   totalSeries = totalSeries + 1;
        // } catch (error) {
        //   console.error(error);
        //   errors.push(`Failed to update ${serie.name} series in Elastic.`);
        // }
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

export async function updateComicDetailsFromComicVine(id: string) {
  console.log("Updating comic details from Comic Vine", id);
  const cvData = await getComicIssueDetails(id);
  await elasticUpdateIssue(cvData);
}
