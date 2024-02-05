import { getWeeklyComics } from "./comicvine";
import type { WeeklyComics } from "./comicvine";

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
