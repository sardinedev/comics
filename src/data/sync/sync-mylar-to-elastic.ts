import {
	completeSyncRun,
	createSyncRun,
	createSyncRunProgressReporter,
	failSyncRun,
} from "@data/elastic/syncRuns";
import { syncMylarToElastic } from "./mylar-to-elastic";

const enrichFromComicVine =
	(process.env.SYNC_ENRICH_COMICVINE ?? "false") === "true";
const cacheCovers = (process.env.SYNC_CACHE_COVERS ?? "true") === "true";
const seriesLimit = process.env.SYNC_SERIES_LIMIT
	? Number(process.env.SYNC_SERIES_LIMIT)
	: undefined;

let syncRunId: string | undefined;
let progressReporter:
	| ReturnType<typeof createSyncRunProgressReporter>
	| undefined;

try {
	const syncRun = await createSyncRun({
		kind: enrichFromComicVine ? "enrichment" : "fast",
		enrichFromComicVine,
		cacheCovers,
		seriesLimit,
	});
	syncRunId = syncRun.run_id;
	progressReporter = createSyncRunProgressReporter(syncRun.run_id);
} catch (error) {
	console.error("Failed to start sync progress tracking", error);
}

try {
	const stats = await syncMylarToElastic({
		enrichFromComicVine,
		cacheCovers,
		seriesLimit,
		refresh: "wait_for",
		progressReporter,
	});

	if (syncRunId) {
		try {
			await completeSyncRun(syncRunId, stats);
		} catch (error) {
			console.error("Failed to complete sync progress tracking", error);
		}
	}

	console.info("Sync complete", stats);
} catch (error) {
	if (syncRunId) {
		try {
			await failSyncRun(syncRunId, error);
		} catch (progressError) {
			console.error("Failed to mark sync progress as failed", progressError);
		}
	}
	throw error;
}
