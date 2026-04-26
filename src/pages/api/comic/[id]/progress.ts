import type { APIRoute } from "astro";
import { getIssue, updateReadingProgress } from "@data/elastic/queries";

async function handleProgress(id: string, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "Request body must be a JSON object" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { current_page, total_pages } = body as { current_page?: number; total_pages?: number };

  if (typeof current_page !== "number" || !Number.isInteger(current_page) || current_page < 1) {
    return new Response(JSON.stringify({ error: "current_page must be a positive integer" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const issue = await getIssue(id);
  if (!issue) {
    return new Response(JSON.stringify({ error: "Issue not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Prefer client-reported total (actual extracted pages), fall back to ES metadata
  const resolvedTotal = (typeof total_pages === "number" && total_pages > 0)
    ? total_pages
    : (issue.issue_page_count ?? 0);

  try {
    await updateReadingProgress(id, current_page, resolvedTotal);
  } catch (err) {
    console.error("Failed to update reading progress:", err);
    return new Response(JSON.stringify({ error: "Failed to update progress" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// PATCH for normal fetch calls
export const PATCH: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing issue ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handleProgress(id, request);
};

// POST for navigator.sendBeacon (which always sends POST)
export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing issue ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handleProgress(id, request);
};
