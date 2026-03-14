import { syncMylarToElastic } from "./mylar-to-elastic";

// Run with:
//   source .env.local && SYNC_SERIES_LIMIT=1 npx tsx src/data/sync/sync-mylar-to-elastic.ts

const enrichFromComicVine =
  (process.env.SYNC_ENRICH_COMICVINE ?? "false") === "true";
const cacheCovers = (process.env.SYNC_CACHE_COVERS ?? "false") === "true";
const seriesLimit = process.env.SYNC_SERIES_LIMIT
  ? Number(process.env.SYNC_SERIES_LIMIT)
  : undefined;

const stats = await syncMylarToElastic({
  enrichFromComicVine,
  cacheCovers,
  seriesLimit,
  refresh: "wait_for",
});

console.info("Sync complete", stats);
