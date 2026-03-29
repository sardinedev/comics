import type { APIRoute } from "astro";
import { getAllSeries } from "@data/elastic/queries";

export const GET: APIRoute = async ({ url }) => {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));

  try {
    const series = await getAllSeries(page, pageSize);

    return new Response(JSON.stringify(series), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to fetch series:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch series" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
