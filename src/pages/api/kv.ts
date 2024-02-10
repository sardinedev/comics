import {
  getComicIssueDetails,
  getVolumeDetails,
  getWeeklyComics,
} from "./comicvine";
import type { WeeklyComics } from "./comicvine";
import type {
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
  id: number,
  kv: KVNamespace
): Promise<ComicvineVolumeResponse | undefined> {
  try {
    const kvIssue = await kv.get(`4050-${id}`);
    if (kvIssue) {
      return JSON.parse(kvIssue);
    } else {
      const response = await getVolumeDetails(id);
      if (response) {
        await kv.put(`4050-${id}`, JSON.stringify(response), {
          expirationTtl: 60 * 60 * 24 * 7, // 7 days
        });
        return response;
      }
    }
  } catch (error) {
    console.error(error);
  }
}
