import { flagIfSessionExpired } from "@stores/offline.store";

export type AddSeriesResult = "added" | "failed" | "auth-required";

/** Asks the server to add a series to Mylar. The route is idempotent. */
export async function addSeriesToLibrary(
	seriesId: string,
): Promise<AddSeriesResult> {
	try {
		const response = await fetch("/api/library/add", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ seriesId }),
		});
		if (flagIfSessionExpired(response)) return "auth-required";
		return response.ok ? "added" : "failed";
	} catch {
		return "failed";
	}
}
