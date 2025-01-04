import type { APIContext } from "astro";
import { elasticBulkUpdate } from "@util/elastic";

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
    const series = await elasticBulkUpdate(body);
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
