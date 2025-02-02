import type { APIContext } from "astro";
import { mylarAddSeries } from "@util/mylar";

export async function PUT({ params }: APIContext) {
  const { id } = params as { id: string };

  try {
    const series = await mylarAddSeries(id);
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
