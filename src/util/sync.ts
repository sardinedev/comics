import { getComicIssueDetails, getVolumeDetails } from "./comicvine";
import type {
  ComicvineSingleIssueResponse,
  ComicvineVolumeResponse,
} from "./comicvine.types";
import {
  getElasticClient,
  elasticUpdateIssue,
  elasticBulkUpdateSeries,
  elasticBulkUpdateIssues,
} from "./elastic";
import { getMylarSeries } from "./mylar";

/*
 * Seeds elasticsearch database.
 * 1- Fetches series data from Mylar.
 * 2- Fetches series data from Comic Vine.
 * 3- Bulk updates the series data in elasticsearch.
 * 4- Fetches issue data from Comic Vine for each issue in the series.
 * 5- Bulk updates the issue data in elasticsearch.
 */
export async function seedElastic() {
  try {
    const { data } = await getMylarSeries();
    let series: ComicvineVolumeResponse[] = [];

    for (const { ComicID } of data) {
      if (!ComicID) {
        throw "No data found for issue";
      }
      console.log("Updating issue", ComicID);
      const cvSeries = await getVolumeDetails(ComicID);
      if (cvSeries) {
        series.push(cvSeries);
      }
    }
    await elasticBulkUpdateSeries(series);

    const issueIDs = series.flatMap((serie) =>
      serie.issues.map((issue) => issue.id)
    );

    const responses = await Promise.all(
      issueIDs.map((id) => getComicIssueDetails(id))
    );

    // removes undefined responses
    const issues = responses.filter(
      (response): response is ComicvineSingleIssueResponse => {
        return response !== undefined;
      }
    );

    await elasticBulkUpdateIssues(issues);
    return {
      series: series.length,
      issues: issues.length,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

export async function syncMylarSeries() {
  try {
    const elastic = getElasticClient();
    const { data } = await getMylarSeries();

    data.forEach(({ ComicID }) => {
      if (!ComicID) {
        throw "No data found for issue";
      }
      console.log("Updating issue", ComicID);
      return syncSeriesDataFromComicVine(ComicID);
    });

    const operations = series.flatMap((serie) => [
      { index: { _index: "series", _id: serie.id } },
      serie,
    ]);

    const bulkResponse = await elastic.bulk({ refresh: true, operations });

    if (bulkResponse.errors) {
      console.error(bulkResponse);
      throw new Error("Failed to sync series to Elastic.");
    }

    return bulkResponse;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

export async function syncSeriesDataFromComicVine(id: string) {
  console.log("Syncing series data from Comic Vine", id);
  const elastic = getElasticClient();
  const cvData = await getVolumeDetails(id);
  if (cvData) {
    await elastic.index({
      index: "series",
      id,
      document: cvData,
    });

    const issueIDs = cvData.issues.map((issue) => issue.id);

    const responses = await Promise.all(
      issueIDs.map((id) => getComicIssueDetails(id))
    );

    responses.forEach(async (response) => {
      if (!response) {
        throw "No data found for issue";
      }
      console.log("Updating issue", response.id);
      return elasticUpdateIssue(response);
    });
  }
}
