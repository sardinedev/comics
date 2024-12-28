import type { APIContext } from "astro";
import { elasticGetSeries, elasticUpdate } from "../../../util/elastic";

export async function GET({ params }: APIContext) {
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "No ID provided",
    });
  }

  try {
    const series = await elasticGetSeries(id, {
      size: 50,
      page: 1,
      sort: "asc",
    });
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
