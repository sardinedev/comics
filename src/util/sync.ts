import {
  elasticAddIssueWithoutUpdate,
  elasticCreateIndex,
  elasticUpdateIssue,
} from "./elastic";
import { mylarGetAllSeries, mylarGetSeries } from "./mylar";
import { formatMylarIssue } from "./formatter";

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
 *
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
          try {
            const update = await elasticAddIssueWithoutUpdate(formatedIssue);
            if (update.result === "skipped") {
              console.info(update.message);
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
