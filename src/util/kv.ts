import {
  getComicIssueDetails,
  getIssuesFromVolume,
  getVolumeDetails,
  getWeeklyComics,
} from "./comicvine";
import type { WeeklyComics } from "./comicvine";
import type {
  ComicvineIssuesResponse,
  ComicvineSingleIssueResponse,
  ComicvineVolumeResponse,
} from "./comicvine.types";

export async function kvGetWeeklyComics(
  startOfWeek: string,
  endOfWeek: string,
  kv: KVNamespace
): Promise<WeeklyComics | undefined> {
  try {
    const kvWeekly = await kv.get(`${startOfWeek}-${endOfWeek}`);
    if (kvWeekly) {
      return JSON.parse(kvWeekly);
    } else {
      const response = await getWeeklyComics(startOfWeek, endOfWeek);
      if (response) {
        await kv.put(`${startOfWeek}-${endOfWeek}`, JSON.stringify(response), {
          expirationTtl: 60 * 60 * 24, // 1 day
        });
        return response;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvGetComicIssue(
  id: number | string,
  kv: KVNamespace
): Promise<ComicvineSingleIssueResponse | undefined> {
  try {
    const kvIssue = await kv.get(`4000-${id}`);
    if (kvIssue) {
      return JSON.parse(kvIssue);
    } else {
      const response = await getComicIssueDetails(id);
      if (response) {
        await kv.put(`4000-${id}`, JSON.stringify(response), {
          expirationTtl: 60 * 60 * 24 * 7, // 7 days
        });
        return response;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvGetVolume(
  id: number | string,
  kv: KVNamespace
): Promise<ComicvineVolumeResponse | undefined> {
  try {
    const kvIssue = await kv.get(`4050-${id}`);
    if (kvIssue) {
      return JSON.parse(kvIssue);
    } else {
      const response = await getVolumeDetails(id);
      if (response) {
        const issuesFromVolume = await kvGetIssuesFromVolume(id, kv);
        let cover_image: string[] = [];
        if (issuesFromVolume) {
          cover_image = issuesFromVolume
            .reverse()
            .slice(0, 5)
            .map((issue) => issue.image.medium_url);

          // sort by issue number
          response.issues.sort(
            (a, b) => parseInt(a.issue_number) - parseInt(b.issue_number)
          );

          for (const responseIssue of response.issues) {
            const issue = issuesFromVolume.find(
              (issue) => issue.id === responseIssue.id
            );
            if (issue) {
              responseIssue.image = issue.image;
            }
          }
        }
        const fullResponse = {
          ...response,
          cover_image,
        };
        await kv.put(`4050-${id}`, JSON.stringify(fullResponse), {
          expirationTtl: 60 * 60 * 24 * 7, // 7 days
        });
        return fullResponse;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvGetIssuesFromVolume(
  volumeId: number | string,
  kv: KVNamespace
): Promise<ComicvineIssuesResponse[] | undefined> {
  try {
    const issues = await getIssuesFromVolume(volumeId);
    if (issues) {
      for (const issue of issues) {
        await kv.put(`4000-${issue.id}`, JSON.stringify(issue), {
          expirationTtl: 60 * 60 * 24 * 7, // 7 days
        });
      }
      return issues;
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvGetFollowSeries(
  kv: KVNamespace
): Promise<{ series: string[] } | undefined> {
  try {
    const series = await kv.get("follow-series");
    if (series) {
      return JSON.parse(series);
    } else {
      const seriesBoilerplate = {
        series: [],
      };
      await kv.put("follow-series", JSON.stringify(seriesBoilerplate), {
        expirationTtl: 60 * 60 * 24 * 365, // 1 year
      });
      return seriesBoilerplate;
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvAddFollowSeries(
  series: string,
  kv: KVNamespace
): Promise<{ series: string[] } | undefined> {
  try {
    const seriesData = await kvGetFollowSeries(kv);
    if (seriesData) {
      seriesData.series.push(series);
      await kv.put("follow-series", JSON.stringify(seriesData), {
        expirationTtl: 60 * 60 * 24 * 365, // 1 year
      });
      return seriesData;
    }
  } catch (error) {
    console.error(error);
  }
}
