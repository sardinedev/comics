import type { APIContext } from "astro";
import { elasticBulkUpdate } from "../../util/elastic";

export async function POST({ request }: APIContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  if (!Array.isArray(body)) {
    return new Response(
      JSON.stringify({ error: "Body must be an array of partial issues" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const missingIds = body.filter(
    (item) => !item || typeof item !== "object" || !("issue_id" in item)
  );
  if (missingIds.length > 0) {
    return new Response(
      JSON.stringify({
        error: "Every item must include issue_id",
        invalidItems: missingIds.length,
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    const res = await elasticBulkUpdate(body as any);
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("/api/bulk-update failed:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to bulk update issues",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}
