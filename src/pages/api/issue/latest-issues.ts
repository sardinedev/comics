import { elasticGetLatestIssues } from "../../../util/elastic";

export async function GET() {
  let issues;
  try {
    issues = await elasticGetLatestIssues();
  } catch (error) {
    return new Response(null, {
      status: 500,
      statusText: `Failed to fetch latest issues: ${error}`,
    });
  }
  if (!issues) {
    return new Response(null, {
      status: 404,
      statusText: "No issues found",
    });
  }
  return new Response(JSON.stringify(issues), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
