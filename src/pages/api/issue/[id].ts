import { kvGetComicIssue } from "../../../util/kv";
import { getElasticClient } from "../../../util/elastic";

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

export async function POST({ params, request, locals }: APIContext) {
  const elastic = getElasticClient();
  const { id } = params;
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }
  const issue = await request.json();
  const update = await elastic.index({
    index: "issues",
    id,
    document: issue,
  });
  return new Response(JSON.stringify(update.result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
