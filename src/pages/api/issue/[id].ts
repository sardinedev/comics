import { elasticGetComicIssue } from "../../../util/elastic";

import type { APIContext } from "astro";

export async function GET({ params }: APIContext) {
  const { id } = params;
  console.log("Fetching issue", id);
  if (!id) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }
  const issue = await elasticGetComicIssue(id);
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
