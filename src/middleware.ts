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

// Allow public static assets needed by unauthenticated pages like /login.
// Cover images are treated as public — they're static assets with no sensitive
// content, and subresource requests don't always carry cookies reliably across
// the localhost/127.0.0.1 hostname split used by the ATProto dev OAuth flow.
const PUBLIC_PREFIXES = ["/_astro/", "/covers/"];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals } = context;

  if (
    PUBLIC_PATHS.includes(url.pathname) ||
    PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p))
  ) {
    return next();
  }

  const devBypassDid = env("DEV_BYPASS_AUTH");
  const isLocalDevRequest =
    import.meta.env.DEV &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (devBypassDid && isLocalDevRequest) {
    console.info(`DEV_BYPASS_AUTH is set, bypassing authentication and using DID ${devBypassDid}`);
    locals.did = devBypassDid;
    return next();
  }
  if (devBypassDid && !isLocalDevRequest) {
    console.warn("Ignoring DEV_BYPASS_AUTH: only allowed on localhost in dev mode.");
  }

  const allowedDid = env("AUTH_ALLOWED_DID");
  if (!allowedDid) {
    console.error("Missing required AUTH_ALLOWED_DID configuration.");
    return new Response("Server misconfiguration: AUTH_ALLOWED_DID is not set.", {
      status: 500,
    });
  }

  const did = getSessionDid(request);
  if (!did || did !== allowedDid) {
    return context.redirect("/login");
  }

  locals.did = did;
  return next();
});
