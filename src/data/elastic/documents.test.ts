import { describe, it, expect, vi, beforeEach } from "vitest";

// Set environment variables BEFORE importing the module
process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

const elasticState = {
  bulk: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
  return {
    Client: class {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      bulk = (...args: any[]) => elasticState.bulk(...args);
      indices = {};
    },
  };
});

const documents = await import("./documents");

describe("summarizeBulkResponse", () => {
  it("returns summary with no errors for successful bulk response", () => {
    const response = {
      took: 42,
      errors: false,
      items: [
        { update: { _index: "issues", _id: "1", status: 200 } },
        { update: { _index: "issues", _id: "2", status: 200 } },
      ],
    };

    const summary = documents.summarizeBulkResponse(response);

    expect(summary).toEqual({
      took: 42,
      errors: false,
      errorCount: 0,
      errorsSample: [],
    });
  });

  it("collects error items in errorsSample", () => {
    const response = {
      took: 10,
      errors: true,
      items: [
        { update: { _index: "issues", _id: "1", status: 200 } },
        {
          update: {
            _index: "issues",
            _id: "2",
            status: 400,
            error: { type: "mapper_parsing_exception", reason: "field [bad] not found" },
          },
        },
        {
          update: {
            _index: "issues",
            _id: "3",
            status: 409,
            error: { type: "version_conflict_engine_exception" },
          },
        },
      ],
    };

    const summary = documents.summarizeBulkResponse(response);

    expect(summary.took).toBe(10);
    expect(summary.errors).toBe(true);
    expect(summary.errorCount).toBe(2);
    expect(summary.errorsSample).toHaveLength(2);
    expect(summary.errorsSample[0]).toEqual({
      index: "issues",
      id: "2",
      status: 400,
      error: { type: "mapper_parsing_exception", reason: "field [bad] not found" },
    });
  });

  it("respects maxErrorsSample option", () => {
    const response = {
      took: 10,
      errors: true,
      items: Array.from({ length: 20 }, (_, i) => ({
        update: {
          _index: "issues",
          _id: String(i),
          status: 400,
          error: { type: "test_error" },
        },
      })),
    };

    const summary = documents.summarizeBulkResponse(response, { maxErrorsSample: 3 });

    expect(summary.errorCount).toBe(20);
    expect(summary.errorsSample).toHaveLength(3);
  });
});

describe("elasticBulkUpsertDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds update+doc/upsert pairs for single document", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 5,
      errors: false,
      items: [{ update: { _index: "issues", _id: "1", status: 200 } }],
    });

    await documents.elasticBulkUpsertDocuments(
      "issues",
      [
        {
          id: "1",
          doc: { download_status: "Downloaded" },
          upsert: {
            issue_id: "1",
            series_id: "s1",
            issue_number: 1,
            issue_date: "2026-01-01",
            download_status: "Downloaded",
            synced_at: "2026-01-01T00:00:00.000Z",
          },
        },
      ]
    );

    expect(elasticState.bulk).toHaveBeenCalledWith({
      body: [
        { update: { _index: "issues", _id: "1" } },
        {
          doc: { download_status: "Downloaded" },
          upsert: {
            issue_id: "1",
            series_id: "s1",
            issue_number: 1,
            issue_date: "2026-01-01",
            synced_at: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
      refresh: undefined,
    });
  });

  it("builds bulk body for multiple documents", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 10,
      errors: false,
      items: [
        { update: { _index: "issues", _id: "1", status: 200 } },
        { update: { _index: "issues", _id: "2", status: 200 } },
      ],
    });

    await documents.elasticBulkUpsertDocuments("issues", [
      {
        id: "1",
        doc: { download_status: "Downloaded" },
        upsert: {
          issue_id: "1",
          download_status: "Downloaded",
          synced_at: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        id: "2",
        doc: { download_status: "Wanted" },
        upsert: {
          issue_id: "2",
          download_status: "Wanted",
          synced_at: "2026-01-01T00:00:00.000Z",
        },
      },
    ]);

    const body = elasticState.bulk.mock.calls[0][0].body;
    expect(body).toHaveLength(4); // 2 docs × 2 lines each
    expect(body[0]).toEqual({ update: { _index: "issues", _id: "1" } });
    expect(body[2]).toEqual({ update: { _index: "issues", _id: "2" } });
  });

  it("passes refresh option to bulk API", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 5,
      errors: false,
      items: [{ update: { _index: "issues", _id: "1", status: 200 } }],
    });

    await documents.elasticBulkUpsertDocuments(
      "issues",
      [
        {
          id: "1",
          doc: {},
          upsert: { issue_id: "1", synced_at: "2026-01-01T00:00:00.000Z" },
        },
      ],
      { refresh: "wait_for" }
    );

    expect(elasticState.bulk).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: "wait_for" })
    );
  });

  it("handles empty docs array", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 0,
      errors: false,
      items: [],
    });

    const summary = await documents.elasticBulkUpsertDocuments("issues", []);

    expect(elasticState.bulk).toHaveBeenCalledWith({
      body: [],
      refresh: undefined,
    });
    expect(summary.errorCount).toBe(0);
  });

  it("throws with helpful message when bulk has errors", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 5,
      errors: true,
      items: [
        {
          update: {
            _index: "issues",
            _id: "1",
            status: 400,
            error: { type: "mapper_parsing_exception", reason: "bad" },
          },
        },
      ],
    });

    await expect(
      documents.elasticBulkUpsertDocuments(
        "issues",
        [
          {
            id: "1",
            doc: { download_status: "Downloaded" },
            upsert: {
              issue_id: "1",
              series_id: "s1",
              issue_number: 1,
              issue_date: "2026-01-01",
              download_status: "Downloaded",
              synced_at: "2026-01-01T00:00:00.000Z",
            },
          },
        ]
      )
    ).rejects.toThrow(
      "Elasticsearch bulk upsert had 1 errors. First error: index=issues id=1 status=400"
    );
  });

  it("returns summary with error count on success", async () => {
    elasticState.bulk.mockResolvedValue({
      took: 12,
      errors: false,
      items: [{ update: { _index: "issues", _id: "1", status: 200 } }],
    });

    const summary = await documents.elasticBulkUpsertDocuments("issues", [
      {
        id: "1",
        doc: {},
        upsert: { issue_id: "1", synced_at: "2026-01-01T00:00:00.000Z" },
      },
    ]);

    expect(summary).toEqual({
      took: 12,
      errors: false,
      errorCount: 0,
      errorsSample: [],
    });
  });
});
