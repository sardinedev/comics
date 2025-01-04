import type { MylarComic, MylarComicWithIssues } from "./mylar.types";

const MYLAR_API_KEY = import.meta.env.MYLAR_API_KEY;
const MYLAR_URL = import.meta.env.PUBLIC_MYLAR_URL;

export type MylarResponse<T> = {
  result: string;
  data: T;
};

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

export function mylarGetAllSeries() {
  try {
    return mylar<MylarComic[]>("getIndex");
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch indexer status from Mylar.");
  }
}

export function mylarGetSeries(id: string) {
  try {
    return mylar<MylarComicWithIssues>(`getComic&id=${id}`);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch series from Mylar.");
  }
}

export function mylarGetUpcoming() {
  try {
    return mylar<MylarComic[]>("getUpcoming&include_downloaded_issues=Y");
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch upcoming comics from Mylar.");
  }
}
