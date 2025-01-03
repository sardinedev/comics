import type { APIContext } from "astro";
import { elasticUpdate } from "../../../../util/elastic";
import type { SeriesUpdate } from "../../../../util/comics.types";

export async function POST({ params, request }: APIContext) {
  const { id } = params;
  const body = await request.json();
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "No ID provided",
    });
  }

  try {
    const series = await elasticUpdate(body, id);
    return new Response(JSON.stringify(series), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(null, {
      status: 404,
      statusText: "No ID founded",
    });
  }
}
