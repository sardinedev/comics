type ComicvineIssue = {
  name: string;
  issue_number: string;
  site_detail_url: string;
  id: number;
  image: {
    icon_url: string;
    medium_url: string;
    screen_url: string;
    screen_large_url: string;
    small_url: string;
    super_url: string;
    thumb_url: string;
    tiny_url: string;
    original_url: string;
    image_tags: string;
  };
  volume: {
    api_detail_url: string;
    id: number;
    name: string;
    site_detail_url: string;
  };
};

type ComicvineIssuesResponse = {
  number_of_total_results: number;
  results: ComicvineIssue[];
};

export type ComicIssue = {
  name: string;
  issueNumber: string;
  id: number;
  cover: string;
  volume: {
    id: number;
    name: string;
  };
};

export type WeeklyComics = {
  totalResults: number;
  issues: ComicIssue[];
};

const COMICVINE_API_KEY = "d1dc24fd2bc230094c37a518cfa7b88aa43443ac";

const COMICVINE_URL = "https://comicvine.gamespot.com/api";

async function comicvine<T>(
  endpoint: string,
  params: string
): Promise<T | undefined> {
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

export async function getWeeklyComics(startOfWeek: string, endOfWeek: string) {
  try {
    const data = await comicvine<ComicvineIssuesResponse>(
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
