import type { estypes } from "@elastic/elasticsearch";

/**
 * Read model index for operational sync/enrichment runs.
 */
export const SYNC_RUNS_INDEX = "sync_runs";

export type SyncRunKind = "fast" | "enrichment";
export type SyncRunStatus = "running" | "completed" | "failed";

export type SyncRunDocument = {
	run_id: string;
	kind: SyncRunKind;
	status: SyncRunStatus;
	started_at: string;
	updated_at: string;
	completed_at?: string;
	enrich_from_comicvine: boolean;
	cache_covers: boolean;
	series_limit?: number;
	series_seen: number;
	series_total: number;
	series_synced: number;
	issues_seen: number;
	issues_upserted: number;
	issues_enriched: number;
	covers_cached: number;
	current_series_id?: string | null;
	current_series_name?: string | null;
	current_issue_id?: string | null;
	current_issue_number?: string | null;
	current_issue_name?: string | null;
	last_error?: string | null;
};

/**
 * Elasticsearch mappings for the `sync_runs` index.
 */
export const syncRunsMappings: estypes.MappingTypeMapping = {
	properties: {
		run_id: { type: "keyword" },
		kind: { type: "keyword" },
		status: { type: "keyword" },
		started_at: { type: "date" },
		updated_at: { type: "date" },
		completed_at: { type: "date" },
		enrich_from_comicvine: { type: "boolean" },
		cache_covers: { type: "boolean" },
		series_limit: { type: "integer" },
		series_seen: { type: "integer" },
		series_total: { type: "integer" },
		series_synced: { type: "integer" },
		issues_seen: { type: "integer" },
		issues_upserted: { type: "integer" },
		issues_enriched: { type: "integer" },
		covers_cached: { type: "integer" },
		current_series_id: { type: "keyword" },
		current_series_name: {
			type: "text",
			fields: {
				keyword: { type: "keyword" },
			},
		},
		current_issue_id: { type: "keyword" },
		current_issue_number: { type: "keyword" },
		current_issue_name: {
			type: "text",
			fields: {
				keyword: { type: "keyword" },
			},
		},
		last_error: { type: "text" },
	},
};
