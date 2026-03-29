import { syncMylarToElastic } from "./mylar-to-elastic";

const enrichFromComicVine =
  (process.env.SYNC_ENRICH_COMICVINE ?? "false") === "true";
const cacheCovers = (process.env.SYNC_CACHE_COVERS ?? "true") === "true";
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
