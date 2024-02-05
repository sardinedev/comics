type ComicIssue = {
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

type ComicVineResponse = {
  number_of_total_results: number;
  results: ComicIssue[];
};

export async function getWeeklyComics(startOfWeek: string, endOfWeek: string) {
  try {
    const response = await fetch(
      `https://comicvine.gamespot.com/api/issues?api_key=d1dc24fd2bc230094c37a518cfa7b88aa43443ac&format=json&filter=store_date:${startOfWeek}|${endOfWeek}`,
      { headers: { "User-Agent": "marabyte.com" } }
    );
    const data: ComicVineResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching weekly comics", error);
  }
}
