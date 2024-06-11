import type { APIContext } from "astro";
import { getElasticClient } from "../../../util/elastic";
import { syncMylarSeries } from "../../../util/sync";

export async function GET() {
  const elastic = getElasticClient();
  let series;
  try {
    series = await elastic.search({
      index: "series",
      _source: true,
      size: 10000, // Adjust this value according to your index size,
    });
  } catch (error) {
    if (error.meta.statusCode === 404) {
      console.info("Index not found, creating index");
      const update = await syncMylarSeries();
      return new Response(
        JSON.stringify({
          data: `Elastic index was empty and was updated with ${update.items.length} series from Mylar`,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
    return new Response(JSON.stringify(error), {
      status: 500,
      statusText: "Failed to fetch series.",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const { hits } = series.hits;
  const result = hits.map((s) => s._source);

  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
