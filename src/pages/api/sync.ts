import type { APIContext } from "astro";
import { syncMylarWithElastic } from "../../util/sync";

export async function GET({ params }: APIContext) {
  try {
    const result = await syncMylarWithElastic();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error seeding Elastic", error);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      statusText: "Error seeding Elastic",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
