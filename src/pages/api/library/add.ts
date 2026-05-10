import { mylarAddSeries } from "@data/mylar/mylar";
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request }) => {
	const { seriesId } = await request.json();

	if (!seriesId) {
		return new Response(JSON.stringify({ error: "seriesId is required" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const result = await mylarAddSeries(String(seriesId));
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("Failed to add series to library", error);
		return new Response(
			JSON.stringify({ error: "Failed to add series to library" }),
			{
				status: 502,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
};
