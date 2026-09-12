import { mylarAddSeries } from "@data/mylar/mylar";
import type { APIRoute } from "astro";

const completedMutations = new Set<string>();
const inFlightMutations = new Map<string, Promise<unknown>>();
const MAX_COMPLETED_MUTATIONS = 500;

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function isValidIdentifier(value: unknown, maxLength: number): value is string {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > maxLength
	) {
		return false;
	}
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) return false;
	}
	return true;
}

function isAlreadyAdded(value: unknown): boolean {
	const description =
		value instanceof Error
			? value.message.toLowerCase()
			: String(JSON.stringify(value) ?? "").toLowerCase();
	return (
		description.includes("already added") ||
		description.includes("already exists") ||
		description.includes("comic exists")
	);
}

function isFailedMylarResult(value: unknown): boolean {
	if (!value || typeof value !== "object" || !("result" in value)) return false;
	const result = String((value as { result?: unknown }).result).toLowerCase();
	return result === "error" || result === "failed" || result === "failure";
}

function rememberCompletedMutation(key: string): void {
	completedMutations.add(key);
	if (completedMutations.size <= MAX_COMPLETED_MUTATIONS) return;
	const oldest = completedMutations.values().next().value;
	if (oldest) completedMutations.delete(oldest);
}

/** Clears the process-local idempotency ledger between isolated unit tests. */
export function resetLibraryMutationLedgerForTesting(): void {
	completedMutations.clear();
	inFlightMutations.clear();
}

export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be valid JSON" }, 400);
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return json({ error: "Request body must be an object" }, 400);
	}
	const { seriesId, mutationId } = body as {
		seriesId?: unknown;
		mutationId?: unknown;
	};
	if (!isValidIdentifier(seriesId, 128)) {
		return json({ error: "seriesId must be a non-empty string" }, 400);
	}
	if (mutationId !== undefined && !isValidIdentifier(mutationId, 200)) {
		return json({ error: "mutationId must be a non-empty string" }, 400);
	}

	const normalisedSeriesId = seriesId.trim();
	const idempotencyKey = mutationId ?? `series:${normalisedSeriesId}`;
	if (completedMutations.has(idempotencyKey)) {
		return json(
			{
				status: "already-processed",
				seriesId: normalisedSeriesId,
				mutationId: mutationId ?? null,
			},
			200,
		);
	}
	try {
		let operation = inFlightMutations.get(idempotencyKey);
		if (!operation) {
			operation = mylarAddSeries(normalisedSeriesId);
			inFlightMutations.set(idempotencyKey, operation);
		}
		const result = await operation;
		if (isFailedMylarResult(result) && !isAlreadyAdded(result)) {
			throw new Error("Mylar rejected the add-series request");
		}
		rememberCompletedMutation(idempotencyKey);
		return json(
			{
				status: isAlreadyAdded(result) ? "already-added" : "accepted",
				seriesId: normalisedSeriesId,
				mutationId: mutationId ?? null,
				result,
			},
			200,
		);
	} catch (error) {
		if (isAlreadyAdded(error)) {
			rememberCompletedMutation(idempotencyKey);
			return json(
				{
					status: "already-added",
					seriesId: normalisedSeriesId,
					mutationId: mutationId ?? null,
				},
				200,
			);
		}
		console.error("Failed to add series to library", error);
		return json({ error: "Failed to add series to library" }, 502);
	} finally {
		inFlightMutations.delete(idempotencyKey);
	}
};
