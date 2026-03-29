import type { MylarComic, MylarComicWithIssues, MylarHistoryItem } from "./mylar.types";

const MYLAR_API_KEY =
  import.meta.env?.MYLAR_API_KEY ?? process.env.MYLAR_API_KEY;
const MYLAR_URL =
  import.meta.env?.MYLAR_URL ?? process.env.MYLAR_URL ?? "http://192.168.50.190:8090";

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

/**
 * Fetches recent download history from Mylar (snatched/downloaded issues).
 * @returns A promise that resolves to the MylarResponse containing an array of MylarHistoryItem.
 */
export function mylarGetHistory() {
  try {
    return mylar<MylarHistoryItem[]>("getHistory");
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch history from Mylar.");
  }
}

/**
 * Downloads a comic issue file (CBZ/CBR) from Mylar.
 * @param issueId The ComicVine issue ID
 * @returns Uint8Array of the file bytes or null if failed/not downloaded
 */
export async function mylarDownloadIssue(issueId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `${MYLAR_URL}/api?cmd=downloadIssue&id=${issueId}&apikey=${MYLAR_API_KEY}`
    );
    if (!res.ok) {
      console.error(`Mylar downloadIssue failed: ${res.status}`);
      return null;
    }
    // Check content type - should be application/octet-stream or similar for file
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // Error response from Mylar (file not found, not downloaded, etc.)
      const json = await res.json();
      console.error("Mylar downloadIssue returned error:", json);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Detect archive type from magic bytes
    // ZIP (CBZ): starts with "PK" (0x50 0x4B)
    // RAR (CBR): starts with "Rar!" (0x52 0x61 0x72 0x21)
    const isZip = data.length >= 2 && data[0] === 0x50 && data[1] === 0x4B;
    const isRar = data.length >= 4 && data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 && data[3] === 0x21;

    if (isRar) {
      console.warn(
        `Issue ${issueId} is CBR (RAR format): ${(data.length / 1024 / 1024).toFixed(2)} MB - ` +
        `RAR extraction not supported, will use fallback cover`
      );
      // Return data anyway - let covers.ts handle the fallback
      return data;
    }

    if (!isZip) {
      console.error(
        `Mylar downloadIssue returned invalid data for ${issueId}: ` +
        `size=${data.length}, first bytes=[${data.slice(0, 10).join(", ")}], ` +
        `content-type=${contentType}`
      );
      // Log first 200 chars if it looks like text
      if (data.length > 0 && data[0] < 128) {
        const text = new TextDecoder().decode(data.slice(0, 200));
        console.error(`Response text preview: ${text}`);
      }
      return null;
    }

    console.info(`Downloaded issue ${issueId} (CBZ): ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    return data;
  } catch (error) {
    console.error("Error downloading issue from Mylar:", error);
    return null;
  }
}

/**
 * Downloads series cover art from Mylar's getArt endpoint.
 * @param seriesId The ComicVine series/volume ID (ComicID)
 * @returns Uint8Array of image bytes or null if failed
 */
export async function mylarGetSeriesArt(seriesId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(
      `${MYLAR_URL}/api?cmd=getArt&id=${seriesId}&apikey=${MYLAR_API_KEY}`
    );
    if (!res.ok) {
      console.error(`Mylar getArt failed: ${res.status}`);
      return null;
    }
    // Check content type - should be image/jpeg for success
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // Error response
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error("Error fetching series art from Mylar:", error);
    return null;
  }
}
