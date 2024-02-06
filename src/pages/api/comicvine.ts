import type {
  ComicvineIssuesResponse,
  ComicvineResponse,
  ComicvineSingleIssueResponse,
} from "./comicvine.types";

/**
 * Represents a single comic issue.
 */
export type ComicIssue = {
  description?: string;
  name: string;
  issueNumber: string;
  id: number;
  cover: string;
  volume: {
    id: number;
    name: string;
  };
};

/**
 * Represents the weekly comics data.
 */
export type WeeklyComics = {
  totalResults: number;
  issues: ComicIssue[];
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
      const issues: ComicIssue[] = data.results.map((issue) => ({
        name: issue.name,
        issueNumber: issue.issue_number,
        id: issue.id,
        cover: issue.image.medium_url,
        volume: {
          id: issue.volume.id,
          name: issue.volume.name,
        },
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
export async function getComicIssueDetails(issueId: string) {
  try {
    const data = await comicvine<ComicvineSingleIssueResponse>(
      `issue/4000-${issueId}`
    );
    if (data) {
      return {
        description: data.results.description,
        name: data.results.name,
        issueNumber: data.results.issue_number,
        id: data.results.id,
        cover: data.results.image.medium_url,
        volume: {
          id: data.results.volume.id,
          name: data.results.volume.name,
        },
      };
    }
  } catch (error) {
    console.error("Error fetching comic issue details", error);
  }
}
