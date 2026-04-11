import type { APIRoute } from "astro";
import { searchVolumes } from "@data/comicvine/comicvine";
import { SEARCH_RESULT_LIMIT } from "@data/search.constants";

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await searchVolumes(q, SEARCH_RESULT_LIMIT);

  const items = results.map((v) => ({
    id: v.id,
    name: v.name,
    start_year: v.start_year,
    publisher: v.publisher?.name,
    cover_url: v.image?.thumb_url,
  }));

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
};
