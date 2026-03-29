import type { APIRoute } from "astro";
import { mylarAddSeries } from "@data/mylar/mylar";

export const POST: APIRoute = async ({ request }) => {
  const { seriesId } = await request.json();

  if (!seriesId) {
    return new Response(JSON.stringify({ error: "seriesId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await mylarAddSeries(String(seriesId));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to add series to library" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
