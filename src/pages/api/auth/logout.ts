import type { APIRoute } from "astro";
import { getOAuthClient } from "@lib/auth/client";
import { clearSessionCookie, getSessionDid } from "@lib/auth/session";

export const POST: APIRoute = async ({ request }) => {
  const did = getSessionDid(request);

  if (did) {
    try {
      const client = await getOAuthClient();
      await client.revoke(did);
    } catch {
      // best-effort revocation
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearSessionCookie(),
    },
  });
};
