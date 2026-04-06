import type { APIRoute } from "astro";
import { elastic } from "@data/elastic/elastic";
import { ISSUES_INDEX } from "@data/elastic/models/issue.model";
import type { Issue } from "@data/comics.types";

type SeriesHitSource = Pick<
  Issue,
  "series_id" | "series_name" | "series_year" | "series_publisher"
>;
type CoverHitSource = Pick<Issue, "issue_cover_url">;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await elastic.search<SeriesHitSource>({
    index: ISSUES_INDEX,
    size: 8,
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query: q,
              fields: ["series_name^3", "series_publisher"],
              type: "best_fields",
              fuzziness: "AUTO",
            },
          },
          {
            prefix: {
              "series_name.keyword": { value: q, boost: 2 },
            },
          },
        ],
      },
    },
    collapse: {
      field: "series_id",
      inner_hits: {
        name: "first_issue",
        size: 1,
        sort: [{ issue_date: "asc" }],
        _source: ["issue_cover_url"],
      },
    },
    _source: ["series_id", "series_name", "series_year", "series_publisher"],
  });

  const items = response.hits.hits.map((hit) => {
    const src = hit._source!;
    const cover = hit.inner_hits?.first_issue?.hits?.hits?.[0]
      ?._source as CoverHitSource | undefined;
    return {
      series_id: src.series_id,
      series_name: src.series_name ?? "",
      series_year: src.series_year ?? "",
      series_publisher: src.series_publisher,
      series_cover_url: cover?.issue_cover_url,
    };
  });

  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
};
