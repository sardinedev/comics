import type { APIContext } from "astro";
import { seedElastic } from "../../util/sync";

export async function PUT({ params }: APIContext) {
  try {
    const result = await seedElastic();
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
