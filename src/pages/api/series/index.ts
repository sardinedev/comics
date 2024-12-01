import type { APIContext } from "astro";
import { getElasticClient, getAllSeries } from "../../../util/elastic";

export async function GET() {
  let series;
  try {
    series = await getAllSeries();
  } catch (error) {
    return new Response(JSON.stringify(error), {
      status: 500,
      statusText: "Failed to fetch series.",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return new Response(JSON.stringify({ series }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
