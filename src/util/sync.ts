import pThrottle from 'p-throttle';
import { getComicIssueDetails, getVolumeDetails } from "./comicvine";
import {
  elasticBulkUpdateSeries,
  elasticBulkUpdateIssues,
} from "./elastic";
import { getMylarSeries } from "./mylar";

const throttle = pThrottle({
	limit: 1,
	interval: 1000
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
  try {
    const { data } = getMylarSeries();
    const throttledSeries = data.map(({ ComicID }) => throttle(() => getVolumeDetails(ComicID)));
    const series = await Promise.all(throttledSeries.map(fn => fn()));

    await elasticBulkUpdateSeries(series);

    const issueIDs = series.flatMap((serie) =>
      serie.issues.map((issue) => issue.id)
    );

    const throttledIssues = issueIDs.map((id) => throttle(() => getComicIssueDetails(id)));
    const issues = await Promise.all(
      throttledIssues.map(fn => fn())
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
