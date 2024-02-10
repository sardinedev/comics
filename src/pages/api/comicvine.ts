import type {
  ComicvineIssuesResponse,
  ComicvineResponse,
  ComicvineSingleIssueResponse,
  ComicvineVolumeResponse,
} from "./comicvine.types";

/**
 * Represents the weekly comics data.
 */
export type WeeklyComics = {
  totalResults: number;
  issues: ComicvineIssuesResponse[];
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
): Promise<ComicvineResponse<T> | undefined> {
  try {
    const response = await fetch(
      `${COMICVINE_URL}/${endpoint}/?api_key=${COMICVINE_API_KEY}&format=json&${params}`,
      { headers: { "User-Agent": "marabyte.com" } }
    );
    const data = await response.json();
    if (data.status_code !== 1) {
      throw new Error(data.error);
    }
    return data;
  } catch (error) {
    console.error("Error fetching comicvine", error);
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
    const data = await comicvine<ComicvineIssuesResponse[]>(
      "issues",
      `filter=store_date:${startOfWeek}|${endOfWeek}`
    );
    if (data) {
      const issues = data.results.map((issue) => ({
        ...issue,
      }));
      return {
        totalResults: data.number_of_total_results,
        issues,
      };
    }
  } catch (error) {
    console.error("Error fetching weekly comics", error);
  }
}

/**
 * Retrieves the details of a single comic issue based on the specified issue ID.
 * @param issueId - The ID of the comic issue.
 * @returns The details of the comic issue.
 */
export async function getComicIssueDetails(
  issueId: string | number
): Promise<ComicvineSingleIssueResponse | undefined> {
  try {
    const data = await comicvine<ComicvineSingleIssueResponse>(
      `issue/4000-${issueId}`
    );
    if (data) {
      return {
        ...data.results,
      };
    }
  } catch (error) {
    console.error("Error fetching comic issue details", error);
  }
}

/**
 * Retrieves the details of a volume based on the specified issue ID.
 * @param volumeId - The ID of the volume issue.
 * @returns The details of the comic issue.
 */
export async function getVolumeDetails(
  volumeId: number
): Promise<ComicvineVolumeResponse | undefined> {
  try {
    const data = await comicvine<ComicvineVolumeResponse>(
      `volume/4050-${volumeId}`
    );
    if (data) {
      return {
        ...data.results,
      };
    }
  } catch (error) {
    console.error("Error fetching comic volume details", error);
  }
}

export async function getIssuesIdFromVolume(
  volumeId: number,
  limit: number = 10
): Promise<number[] | undefined> {
  try {
    const data = await comicvine<ComicvineVolumeResponse>(
      `volume/4050-${volumeId}`
    );
    if (data) {
      const issues = data.results.issues.map((issue) => issue.id);
      return issues.reverse().slice(0, limit);
    }
  } catch (error) {
    console.error("Error fetching comic issue details", error);
  }
}
