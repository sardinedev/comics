import type { APIContext } from "astro";
import { elasticBulkUpdate } from "@util/elastic";

export async function POST({ params, request }: APIContext) {
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: "No series id provided" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

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

  // If callers include `series_id` in items, ensure it matches the route param.
  const invalidSeriesItem = body.find((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    if (!("series_id" in record)) return false;
    return typeof record.series_id === "string" && record.series_id !== id;
  });

  if (invalidSeriesItem) {
    return new Response(
      JSON.stringify({
        error: "All issues in the payload must belong to the requested series",
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
    const series = await elasticBulkUpdate(body as any);
    return new Response(JSON.stringify(series), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(`/api/series/${id}/read-status failed:`, error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update series read status",
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
