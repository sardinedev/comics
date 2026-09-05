import { getIssue, updateReadingProgress } from "@data/elastic/queries";
import type { APIRoute } from "astro";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: JSON_HEADERS,
	});
}

function parseIsoTimestamp(value: unknown): string | null {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
		return null;
	}
	const timestamp = new Date(value);
	return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

export async function handleProgress(
	id: string,
	request: Request,
): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Invalid JSON" }, 400);
	}

	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return json({ error: "Request body must be a JSON object" }, 400);
	}

	const { current_page, total_pages, updated_at, mutation_id } = body as {
		current_page?: number;
		total_pages?: number;
		updated_at?: unknown;
		mutation_id?: unknown;
	};

	if (
		typeof current_page !== "number" ||
		!Number.isInteger(current_page) ||
		current_page < 1
	) {
		return json({ error: "current_page must be a positive integer" }, 400);
	}

	if (
		typeof total_pages !== "number" ||
		!Number.isInteger(total_pages) ||
		total_pages < 1
	) {
		return json({ error: "total_pages must be a positive integer" }, 400);
	}

	if (current_page > total_pages) {
		return json({ error: "current_page cannot exceed total_pages" }, 400);
	}

	const normalizedUpdatedAt = parseIsoTimestamp(updated_at);
	if (!normalizedUpdatedAt) {
		return json({ error: "updated_at must be an ISO timestamp" }, 400);
	}

	if (
		typeof mutation_id !== "string" ||
		mutation_id.trim().length === 0 ||
		mutation_id.length > 200
	) {
		return json(
			{
				error:
					"mutation_id must be a non-empty string of at most 200 characters",
			},
			400,
		);
	}

	const issue = await getIssue(id);
	if (!issue) {
		return json({ error: "Issue not found" }, 404);
	}

	try {
		const result = await updateReadingProgress(id, {
			currentPage: current_page,
			totalPages: total_pages,
			updatedAt: normalizedUpdatedAt,
			mutationId: mutation_id,
		});
		let savedPage = current_page;
		let savedUpdatedAt = result.updatedAt;
		if (!result.applied) {
			const authoritativeIssue = await getIssue(id, { throwOnError: true });
			const authoritativeUpdatedAt = parseIsoTimestamp(
				authoritativeIssue?.progress_updated_at,
			);
			if (
				!authoritativeIssue ||
				typeof authoritativeIssue.current_page !== "number" ||
				!Number.isInteger(authoritativeIssue.current_page) ||
				authoritativeIssue.current_page < 1 ||
				!authoritativeUpdatedAt
			) {
				throw new Error("Authoritative reading progress unavailable");
			}
			savedPage = authoritativeIssue.current_page;
			savedUpdatedAt = authoritativeUpdatedAt;
		}
		return json({
			ok: true,
			applied: result.applied,
			stale: !result.applied,
			current_page: savedPage,
			updated_at: savedUpdatedAt,
		});
	} catch (err) {
		console.error("Failed to update reading progress:", err);
		return json({ error: "Failed to update progress" }, 500);
	}
}

// PATCH for normal fetch calls
export const PATCH: APIRoute = async ({ params, request }) => {
	const { id } = params;
	if (!id) {
		return json({ error: "Missing issue ID" }, 400);
	}
	return handleProgress(id, request);
};

// POST for navigator.sendBeacon (which always sends POST)
export const POST: APIRoute = async ({ params, request }) => {
	const { id } = params;
	if (!id) {
		return json({ error: "Missing issue ID" }, 400);
	}
	return handleProgress(id, request);
};
