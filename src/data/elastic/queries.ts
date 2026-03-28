import { elastic } from "./elastic";
import { ISSUES_INDEX } from "./models/issue.model";
import type { Issue } from "../comics.types";

type SeriesHitSource = Pick<Issue, "series_id" | "series_name" | "series_year">;
type CoverHitSource = Pick<Issue, "issue_cover_url">;
type SeriesAggregations = { total_series: { value: number } };

export type SeriesSummary = {
  series_id: string;
  series_name: string;
  series_year: string;
  series_cover_url?: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SeriesSort = "title-asc" | "title-desc" | "date-asc" | "date-desc";

type SortClause = Record<string, "asc" | "desc">;

const SORT_CLAUSES: Record<SeriesSort, SortClause[]> = {
  "title-asc":  [{ "series_name.keyword": "asc" },  { series_year: "asc" }],
  "title-desc": [{ "series_name.keyword": "desc" }, { series_year: "desc" }],
  "date-asc":   [{ series_year: "asc" },  { "series_name.keyword": "asc" }],
  "date-desc":  [{ series_year: "desc" }, { "series_name.keyword": "asc" }],
};

/**
 * Fetches paginated series using field collapsing.
 *
 * Uses `collapse` on `series_id` so Elasticsearch handles deduplication,
 * sorting, and pagination in a single request — no in-memory processing.
 *
 * A `cardinality` aggregation provides the total unique series count
 * for pagination controls.
 */
export async function getAllSeries(
  page = 1,
  pageSize = 20,
  sort: SeriesSort = "title-asc",
): Promise<PaginatedResult<SeriesSummary>> {
  const from = (Math.max(1, page) - 1) * pageSize;

  const response = await elastic.search<SeriesHitSource>({
    index: ISSUES_INDEX,
    size: pageSize,
    from,
    collapse: {
      field: "series_id",
      inner_hits: {
        name: "latest_issue",
        size: 1,
        sort: [{ issue_date: "desc" }],
        _source: ["issue_cover_url"],
      },
    },
    sort: SORT_CLAUSES[sort],
    _source: ["series_id", "series_name", "series_year"],
    aggs: {
      total_series: {
        cardinality: { field: "series_id" },
      },
    },
  });

  const aggs = response.aggregations as SeriesAggregations | undefined;
  const total = aggs?.total_series.value ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.max(1, Math.min(page, totalPages || 1));

  const items: SeriesSummary[] = response.hits.hits.map((hit) => {
    const src = hit._source!;
    const innerHit = hit.inner_hits?.latest_issue?.hits?.hits?.[0]?._source as CoverHitSource | undefined;
    return {
      series_id: src.series_id,
      series_name: src.series_name ?? "",
      series_year: src.series_year ?? "",
      series_cover_url: innerHit?.issue_cover_url,
    };
  });

  return { items, total, page: safePage, pageSize, totalPages };
}
