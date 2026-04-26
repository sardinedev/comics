import type { APIRoute } from "astro";
import { getIssue } from "@data/elastic/queries";
import { mylarDownloadIssue } from "@data/mylar/mylar";

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: "Missing issue ID" }), {
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

  if (issue.download_status !== "Downloaded") {
    return new Response(JSON.stringify({ error: "Issue not downloaded" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await mylarDownloadIssue(id);
  if (!data) {
    return new Response(JSON.stringify({ error: "Failed to fetch from Mylar" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate ZIP magic bytes (0x50 0x4B = "PK")
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    return new Response(JSON.stringify({ error: "Unsupported archive format" }), {
      status: 415,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = new Uint8Array(data).buffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="${id.replace(/[^A-Za-z0-9._-]/g, "_")}.cbz"`,

      "Cache-Control": "private, max-age=86400",
    },
  });
};
