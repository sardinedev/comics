import type { APIRoute } from "astro";
import { getOAuthClient } from "@lib/auth/client";

export const GET: APIRoute = () =>
  new Response(null, { status: 302, headers: { Location: "/login" } });

export const POST: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const handleValue = formData.get("handle");
  const handle = typeof handleValue === "string" ? handleValue.trim() : "";

  if (!handle) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=missing_handle" },
    });
  }

  try {
    const client = await getOAuthClient();
    const url = await client.authorize(handle, { scope: "atproto" });
    return new Response(null, {
      status: 302,
      headers: { Location: url.toString() },
    });
  } catch (err) {
    console.error("[auth] authorize error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=authorize_failed" },
    });
  }
};
