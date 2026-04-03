import { defineMiddleware } from "astro:middleware";
import { getSessionDid } from "@lib/auth/session";
import { env } from "@lib/env";

const PUBLIC_PATHS = [
  "/login",
  "/oauth/callback",
  "/client-metadata.json",
  "/api/auth/authorize",
  "/api/auth/logout",
];

// Cover images are treated as public — they're static assets with no sensitive
// content, and subresource requests don't always carry cookies reliably across
// the localhost/127.0.0.1 hostname split used by the ATProto dev OAuth flow.
const PUBLIC_PREFIXES = ["/covers/"];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals } = context;

  if (
    PUBLIC_PATHS.includes(url.pathname) ||
    PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p))
  ) {
    return next();
  }

  const did = getSessionDid(request);
  const allowedDid = env("AUTH_ALLOWED_DID");

  if (!did || did !== allowedDid) {
    return context.redirect("/login");
  }

  locals.did = did;
  return next();
});
