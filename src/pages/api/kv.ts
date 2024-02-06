import { getComicIssueDetails, getWeeklyComics } from "./comicvine";
import type { ComicIssue, WeeklyComics } from "./comicvine";

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
          expirationTtl: 60 * 60 * 24 * 7, // 1 week
        });
        return response;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export async function kvGetComicIssue(
  id: string,
  kv: KVNamespace
): Promise<ComicIssue | undefined> {
  try {
    const kvIssue = await kv.get(id);
    if (kvIssue) {
      return JSON.parse(kvIssue);
    } else {
      const response = await getComicIssueDetails(id);
      if (response) {
        await kv.put(id, JSON.stringify(response), {
          expirationTtl: 60 * 60 * 24 * 7, // 1 week
        });
        return response;
      }
    }
  } catch (error) {
    console.error(error);
  }
}
