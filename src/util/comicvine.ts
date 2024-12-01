import type {
  ComicvineIssues,
  ComicvineResponse,
  ComicvineSingleIssueResponse,
  ComicvineVolume,
} from "./comicvine.types";

/**
 * Represents the weekly comics data.
 */
export type WeeklyComics = {
  totalResults: number;
  issues: ComicvineIssues[];
};

const COMICVINE_API_KEY = "d1dc24fd2bc230094c37a518cfa7b88aa43443ac";

const COMICVINE_URL = "https://comicvine.gamespot.com/api";

/**
 * Fetches data from the Comicvine API.
 * @param endpoint - The API endpoint to fetch data from.
 * @param params - The query parameters for the API request.
 * @returns The response data from the API.
 */
async function comicvine<T>(
  endpoint: string,
  params?: string
): Promise<ComicvineResponse<T>> {
  try {
    const response = await fetch(
      `${COMICVINE_URL}/${endpoint}/?api_key=${COMICVINE_API_KEY}&format=json&${params}`,
      { headers: { "User-Agent": "marabyte.com" } }
    );
    if (!response.ok) {
      throw new Error("responded with HTTP status " + response.status);
    }
    const data = await response.json();
    if (data.status_code !== 1) {
      throw Error(data.error);
    }
    return data;
  } catch (error) {
    console.error(`[Comicvine API]: ${error.message}`);
    throw Error(`[Comicvine API]: ${error.message}`);
  }
}

/**
 * Retrieves the weekly comics based on the specified start and end dates.
 * @param startOfWeek - The start date of the week in the format "YYYY-MM-DD".
 * @param endOfWeek - The end date of the week in the format "YYYY-MM-DD".
 * @returns The weekly comics data.
 */
export async function getWeeklyComics(startOfWeek: string, endOfWeek: string) {
  try {
    const data = await comicvine<ComicvineIssues[]>(
      "issues",
      `filter=store_date:${startOfWeek}|${endOfWeek}`
    );
    return {
      totalResults: data.number_of_total_results,
      issues: data.results,
    };
  } catch (error) {
    // console.error("Fetching weekly comics");
    throw Error(`Fetching weekly comics: ${error.message}`);
  }
}

/**
 * Retrieves the details of a single comic issue based on the specified issue ID.
 * @param issueId - The ID of the comic issue.
 * @returns The details of the comic issue.
 */
export async function getComicIssueDetails(
  issueId: string | number
): Promise<ComicvineSingleIssueResponse> {
  try {
    const data = await comicvine<ComicvineSingleIssueResponse>(
      `issue/4000-${issueId}`
    );
    return {
      ...data.results,
    };
  } catch (error) {
    console.error("Error fetching comic issue details", error);
    throw Error("Error fetching comic issue details");
  }
}

/**
 * Retrieves the details of a volume based on the specified issue ID.
 * @param volumeId - The ID of the volume issue.
 * @returns The details of the comic issue.
 */
export async function getVolumeDetails(
  volumeId: number | string
): Promise<ComicvineVolume> {
  try {
    const data = await comicvine<ComicvineVolume>(`volume/4050-${volumeId}`);
    return {
      ...data.results,
    };
  } catch (error) {
    console.error("Error fetching comic volume details", error);
    throw Error("Error fetching comic volume details");
  }
}

export async function getIssuesFromVolume(
  volumeId: number | string,
  offset: number = 0
): Promise<ComicvineIssues[] | undefined> {
  try {
    const data = await comicvine<ComicvineIssues[]>(
      "issues",
      `filter=volume:${volumeId}&sort=cover_date:asc`
    );
    if (data) {
      return data.results;
    }
  } catch (error) {
    console.error("Error fetching comic issue details", error);
  }
}
