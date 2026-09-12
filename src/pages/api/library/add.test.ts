import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@data/mylar/mylar", () => ({ mylarAddSeries: vi.fn() }));

import { mylarAddSeries } from "@data/mylar/mylar";
import { POST, resetLibraryMutationLedgerForTesting } from "./add";

const mockedMylarAddSeries = vi.mocked(mylarAddSeries);

function request(body: unknown): Request {
	return new Request("https://comics.example/api/library/add", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function post(body: unknown): Promise<Response> {
	return POST({ request: request(body) } as never);
}

beforeEach(() => {
	vi.resetAllMocks();
	resetLibraryMutationLedgerForTesting();
	mockedMylarAddSeries.mockResolvedValue({
		result: "success",
		data: { comic: [], issues: [] },
	});
});

describe("POST /api/library/add", () => {
	test.each([
		[{}, "seriesId"],
		[{ seriesId: "" }, "seriesId"],
		[{ seriesId: 123 }, "seriesId"],
		[{ seriesId: "series-1", mutationId: "" }, "mutationId"],
	])("validates JSON identifiers", async (body, field) => {
		const response = await post(body);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: expect.stringContaining(field),
		});
	});

	test("adds a series using the consolidated JSON contract", async () => {
		const response = await post({
			seriesId: "series-1",
			mutationId: "library:series-1:mutation-1",
		});

		expect(response.status).toBe(200);
		expect(mockedMylarAddSeries).toHaveBeenCalledWith("series-1");
		expect(await response.json()).toMatchObject({
			status: "accepted",
			seriesId: "series-1",
			mutationId: "library:series-1:mutation-1",
		});
	});

	test("does not repeat a completed mutation id", async () => {
		const body = {
			seriesId: "series-1",
			mutationId: "library:series-1:mutation-1",
		};
		expect((await post(body)).status).toBe(200);
		const replay = await post(body);

		expect(replay.status).toBe(200);
		expect(await replay.json()).toMatchObject({ status: "already-processed" });
		expect(mockedMylarAddSeries).toHaveBeenCalledTimes(1);
	});

	test("treats Mylar already-added responses as success", async () => {
		mockedMylarAddSeries.mockResolvedValue({
			result: "error",
			data: "Comic already exists",
		} as never);

		const response = await post({ seriesId: "series-2" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: "already-added" });
	});

	test("returns a retryable upstream failure", async () => {
		mockedMylarAddSeries.mockRejectedValue(new Error("unavailable"));

		const response = await post({ seriesId: "series-3" });
		expect(response.status).toBe(502);
	});
});
