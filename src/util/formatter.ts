import type { Issue, Series } from "./comics.types";
import type { ComicvineVolume } from "./comicvine.types";

export function convertComicvineVolumeToSeries(
  volume: ComicvineVolume
): Series {
  const issues: Issue[] = volume.issues.map((issue) => ({
    id: issue.id.toString(),
    number: parseInt(issue.issue_number),
    name: issue.name,
  }));
  return {
    totalIssues: volume.count_of_issues,
    id: volume.id.toString(),
    issues,
    name: volume.name,
    publisher: volume.publisher.name,
    year: volume.start_year,
  };
}
