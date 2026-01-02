import type { MylarComic, MylarComicWithIssues } from "./mylar.types";

const MYLAR_API_KEY =
  import.meta.env.MYLAR_API_KEY ?? process.env.MYLAR_API_KEY;
const MYLAR_URL = "http://192.168.50.190:8090";

export type MylarResponse<T> = {
  result: string;
  data: T;
};

/**
 * Generic function to make requests to the Mylar API.
 * @param endpoint The API endpoint to call.
 * @param method The HTTP method to use (default is GET).
 * @returns A promise that resolves to the MylarResponse.
 */
export async function mylar<T>(
  endpoint: string,
  method = "GET"
): Promise<MylarResponse<T>> {
  const req = await fetch(
    `${MYLAR_URL}/api?cmd=${endpoint}&apikey=${MYLAR_API_KEY}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return req.json();
}

/**
 * Fetches all comic series from Mylar.
 * @returns A promise that resolves to the MylarResponse containing an array of MylarComic.
 */
export function mylarGetAllSeries() {
  try {
    return mylar<MylarComic[]>("getIndex");
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch indexer status from Mylar.");
  }
}

/**
 * Fetches a specific comic series from Mylar by its ID.
 * @param id The unique identifier of the comic series.
 * @returns A promise that resolves to the MylarResponse containing MylarComicWithIssues.
 */
export function mylarGetSeries(id: string) {
  try {
    return mylar<MylarComicWithIssues>(`getComic&id=${id}`);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch series from Mylar.");
  }
}

/**
 * Fetches upcoming comics from Mylar.
 * @returns A promise that resolves to the MylarResponse containing an array of MylarComic.
 */
export function mylarGetUpcoming() {
  try {
    return mylar<MylarComic[]>("getUpcoming&include_downloaded_issues=Y");
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch upcoming comics from Mylar.");
  }
}

/**
 * Adds a new comic series to Mylar by its ID.
 * @param id The unique identifier of the comic series to add.
 * @returns A promise that resolves to the MylarResponse containing MylarComicWithIssues.
 */
export function mylarAddSeries(id: string) {
  try {
    return mylar<MylarComicWithIssues>(`addComic&id=${id}`);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to add series to Mylar.");
  }
}
