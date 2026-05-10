import type { APIRoute } from "astro";

const JSON_HEADERS = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store",
};

/** Returns the current ComicVine enrichment monitor snapshot as JSON. */
export const GET: APIRoute = async () => {
	try {
		const { getEnrichmentMonitorSnapshot } = await import(
			"@data/elastic/syncRuns"
		);
		const snapshot = await getEnrichmentMonitorSnapshot();
		return new Response(JSON.stringify(snapshot), {
			status: 200,
			headers: JSON_HEADERS,
		});
	} catch (error) {
		console.error("Failed to fetch enrichment sync status", error);
		return new Response(
			JSON.stringify({ error: "Failed to fetch enrichment status" }),
			{
				status: 502,
				headers: JSON_HEADERS,
			},
		);
	}
};
