import type { MylarComic, MylarComicWithIssues } from "./mylar.types";

export type MylarResponse<T> = {
  result: string;
  data: T;
};

export async function mylar<T>(
  endpoint: string,
  method = "GET"
): Promise<MylarResponse<T>> {
  const req = await fetch(
    `http://192.168.50.190:8090/api?cmd=${endpoint}&apikey=933b8cda6b3b1501b26f316b5ecb8efd`,
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
