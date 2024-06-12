import type { APIContext } from "astro";
import { getElasticClient } from "../../../util/elastic";
import { syncSeriesDataFromComicVine } from "../../../util/sync";

export async function GET({ params }: APIContext) {
  const elastic = getElasticClient();
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "No ID provided",
    });
  }

  try {
    const series = await elastic.get({
      index: "series",
      id,
    });

    if (series.found) {
      return new Response(JSON.stringify(series._source), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  } catch (error) {
    return new Response(null, {
      status: 404,
      statusText: "No ID founded",
    });
  }
}

export async function PUT({ params }: APIContext) {
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "No ID provided",
    });
  }

  const response = await syncSeriesDataFromComicVine(id);

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
