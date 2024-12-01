import type { APIContext } from "astro";
import { elasticGetSeries } from "../../../util/elastic";

export async function GET({ params }: APIContext) {
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "No ID provided",
    });
  }

  try {
    const series = await elasticGetSeries(id);
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
