import type { APIRoute } from "astro";
import { searchLibrarySeries } from "@data/elastic/queries";
import { SEARCH_RESULT_LIMIT } from "@data/search.constants";

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { items } = await searchLibrarySeries(q, 1, SEARCH_RESULT_LIMIT);

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
};
