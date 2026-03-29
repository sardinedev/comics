import { elastic } from "./elastic";
import { ISSUES_INDEX } from "./models/issue.model";
import type { Issue } from "../comics.types";

type SeriesHitSource = Pick<
  Issue,
  "series_id" | "series_name" | "series_year" | "series_publisher" | "series_total_issues"
>;
type CoverHitSource = Pick<Issue, "issue_cover_url">;
type SeriesAggregations = { total_series: { value: number } };

export type SeriesSummary = {
  series_id: string;
  series_name: string;
  series_year: string;
  series_cover_url?: string;
  series_publisher?: string;
  series_total_issues?: number;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SeriesSort = "title-asc" | "title-desc" | "date-asc" | "date-desc";

export type SeriesFilters = {
  publisher?: string;
  year?: string;
  readingState?: "unread" | "reading" | "read";
};

export type SeriesFilterOptions = {
  publishers: string[];
  years: string[];
};

type SortClause = Record<string, "asc" | "desc">;

const SORT_CLAUSES: Record<SeriesSort, SortClause[]> = {
  "title-asc":  [{ "series_name.keyword": "asc" },  { series_year: "asc" }],
  "title-desc": [{ "series_name.keyword": "desc" }, { series_year: "desc" }],
  "date-asc":   [{ series_year: "asc" },  { "series_name.keyword": "asc" }],
  "date-desc":  [{ series_year: "desc" }, { "series_name.keyword": "asc" }],
};

/**
 * Fetches paginated issues for a series, sorted by issue number ascending.
 */
export async function getSeriesIssues(
  seriesId: string,
  page = 1,
  pageSize = 18,
): Promise<{ series: SeriesSummary | null } & PaginatedResult<Issue>> {
  const from = (Math.max(1, page) - 1) * pageSize;

  const response = await elastic.search<Issue>({
    index: ISSUES_INDEX,
    size: pageSize,
    from,
    query: { term: { series_id: seriesId } },
    sort: [{ issue_number: "asc" }],
    track_total_hits: true,
  });

  const issues = response.hits.hits.map((h) => h._source!);
  const total = typeof response.hits.total === "number"
    ? response.hits.total
    : (response.hits.total?.value ?? 0);
  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.max(1, Math.min(page, totalPages || 1));

  const first = issues[0];
  const series: SeriesSummary | null = first
    ? {
        series_id: first.series_id,
        series_name: first.series_name ?? "",
        series_year: first.series_year ?? "",
        series_cover_url: first.series_cover_url,
        series_publisher: first.series_publisher,
        series_total_issues: first.series_total_issues,
      }
    : null;

  return { series, items: issues, total, page: safePage, pageSize, totalPages };
}

/**
 * Fetches a single issue by its ID.
 */
export async function getIssue(issueId: string): Promise<Issue | null> {
  try {
    const response = await elastic.get<Issue>({ index: ISSUES_INDEX, id: issueId });
    return response._source ?? null;
  } catch {
    return null;
  }
}

/**
 * The most recently opened issue the user is currently reading.
 * Used for the homepage hero.
 */
export async function getNowReading(): Promise<Issue | null> {
  const response = await elastic.search<Issue>({
    index: ISSUES_INDEX,
    size: 1,
    query: { term: { reading_state: "reading" } },
    sort: [{ last_opened_at: "desc" }],
  });

  return response.hits.hits[0]?._source ?? null;
}

/**
 * Issues the user is currently reading, sorted by most recently opened.
 * Used for the "Continue Reading" strip on the homepage.
 */
export async function getContinueReading(limit = 5): Promise<Issue[]> {
  const response = await elastic.search<Issue>({
    index: ISSUES_INDEX,
    size: limit,
    query: { term: { reading_state: "reading" } },
    sort: [{ last_opened_at: "desc" }],
  });

  return response.hits.hits.map((h) => h._source!);
}

/**
 * Recently added series, collapsed so each series appears once.
 * Sorted by the most recent `added_to_library_at` across all issues in the series.
 */
export async function getRecentlyAdded(limit = 6): Promise<SeriesSummary[]> {
  const response = await elastic.search<SeriesHitSource>({
    index: ISSUES_INDEX,
    size: limit,
    collapse: {
      field: "series_id",
      inner_hits: {
        name: "latest_cover",
        size: 1,
        sort: [{ issue_date: "desc" }],
        _source: ["issue_cover_url"],
      },
    },
    sort: [{ added_to_library_at: "desc" }],
    _source: ["series_id", "series_name", "series_year", "series_publisher", "series_total_issues"],
  });

  return response.hits.hits.map((hit) => {
    const src = hit._source!;
    const cover = hit.inner_hits?.latest_cover?.hits?.hits?.[0]?._source as CoverHitSource | undefined;
    return {
      series_id: src.series_id,
      series_name: src.series_name ?? "",
      series_year: src.series_year ?? "",
      series_cover_url: cover?.issue_cover_url,
      series_publisher: src.series_publisher,
      series_total_issues: src.series_total_issues,
    };
  });
}

/**
 * Returns distinct publishers and years for filter UI.
 */
export async function getSeriesFilterOptions(): Promise<SeriesFilterOptions> {
  const response = await elastic.search({
    index: ISSUES_INDEX,
    size: 0,
    aggs: {
      publishers: { terms: { field: "series_publisher", size: 200, order: { _key: "asc" } } },
      years:      { terms: { field: "series_year",      size: 200, order: { _key: "desc" } } },
    },
  });

  const aggs = response.aggregations as Record<string, { buckets: { key: string }[] }>;
  return {
    publishers: aggs.publishers.buckets.map((b) => b.key).filter(Boolean),
    years:      aggs.years.buckets.map((b) => b.key).filter(Boolean),
  };
}

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
  pageSize = 18,
  sort: SeriesSort = "title-asc",
  filters: SeriesFilters = {},
): Promise<PaginatedResult<SeriesSummary>> {
  const from = (Math.max(1, page) - 1) * pageSize;

  const filterClauses: object[] = [];
  if (filters.publisher)    filterClauses.push({ term: { series_publisher: filters.publisher } });
  if (filters.year)         filterClauses.push({ term: { series_year: filters.year } });
  if (filters.readingState) filterClauses.push({ term: { reading_state: filters.readingState } });

  const response = await elastic.search<SeriesHitSource>({
    index: ISSUES_INDEX,
    size: pageSize,
    from,
    ...(filterClauses.length > 0 && { query: { bool: { filter: filterClauses } } }),
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
    _source: ["series_id", "series_name", "series_year", "series_publisher", "series_total_issues"],
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
      series_publisher: src.series_publisher,
      series_total_issues: src.series_total_issues,
    };
  });

  return { items, total, page: safePage, pageSize, totalPages };
}
