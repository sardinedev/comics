import { kvGetComicIssue } from "../../../util/kv";

import type { APIContext } from "astro";

export async function GET({ params, locals }: APIContext) {
  const kv = locals.runtime.env.COMICS;
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }
  const issue = await kvGetComicIssue(id, kv);
  if (!issue) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }
  return new Response(JSON.stringify(issue), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
