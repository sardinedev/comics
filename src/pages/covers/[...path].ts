import type { APIRoute } from "astro";
import { readCover, getPlaceholderPng } from "@util/covers";

/**
 * Serves cached cover images from local storage.
 * Returns a 1x1 transparent PNG with no-store cache if the file is missing,
 * allowing backfill to populate it later without broken images.
 */
export const GET: APIRoute = async ({ params }) => {
  const { path } = params;

  if (!path) {
    return new Response("Not found", { status: 404 });
  }

  // Extract issue ID from path (e.g., "12345.jpg" -> "12345")
  const issueId = path.replace(/\.[^.]+$/, "");

  const coverData = await readCover(issueId);

  if (coverData) {
    // Determine content type from extension
    const ext = path.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";

    // Convert to a plain ArrayBuffer to satisfy BodyInit typing in Astro's server environment
    const body = new Uint8Array(coverData).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Return placeholder for missing covers (allows backfill later)
  const placeholderBody = new Uint8Array(getPlaceholderPng()).buffer;
  return new Response(placeholderBody, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
};
