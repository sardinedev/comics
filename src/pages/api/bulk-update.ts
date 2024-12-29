import type { APIContext } from "astro";
import { elasticBulkUpdate } from "../../util/elastic";

export async function POST({ request }: APIContext) {
  const body = await request.json();

  try {
    const res = await elasticBulkUpdate(body);
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response(null, {
      status: 404,
      statusText: "No ID founded",
    });
  }
}
