import { describe, it, expect, vi, beforeEach } from "vitest";
import type { estypes } from "@elastic/elasticsearch";

// Set environment variables BEFORE importing the module
process.env.ELASTIC_API_KEY = "test-api-key";
process.env.ELASTIC_URL = "http://localhost:9200";

// Mock state for Elasticsearch client methods
const elasticState = {
  search: vi.fn(),
  mget: vi.fn(),
  count: vi.fn(),
  indices: {
    exists: vi.fn(),
    create: vi.fn(),
    putMapping: vi.fn(),
    delete: vi.fn(),
    updateAliases: vi.fn(),
    putAlias: vi.fn(),
  },
  reindex: vi.fn(),
};

// Mock the @elastic/elasticsearch Client
vi.mock("@elastic/elasticsearch", () => {
  return {
    Client: class {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      search = (...args: any[]) => elasticState.search(...args);
      mget = (...args: any[]) => elasticState.mget(...args);
      count = (...args: any[]) => elasticState.count(...args);
      indices = elasticState.indices;
      reindex = (...args: any[]) => elasticState.reindex(...args);
    },
  };
});

// Import after setting env and mocking
const reindex = await import("./reindex");

describe("elasticReindex", () => {
  const testMappings: estypes.MappingTypeMapping = {
    properties: {
      title: { type: "text" },
    },
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Set up common successful path mocks
    elasticState.indices.exists.mockResolvedValue(true);
    elasticState.indices.create.mockResolvedValue({
      acknowledged: true,
      shards_acknowledged: true,
    });
    elasticState.reindex.mockResolvedValue({
      total: 100,
      took: 1500,
      version_conflicts: 0,
    });
    elasticState.count.mockResolvedValue({ count: 100 });
    elasticState.indices.updateAliases.mockResolvedValue({
      acknowledged: true,
    });
  });

  it("should successfully reindex with default timestamp suffix", async () => {
    await reindex.elasticReindex("old-index", { mappings: testMappings });

    expect(elasticState.indices.exists).toHaveBeenCalledWith({
      index: "old-index",
    });
    expect(elasticState.indices.create).toHaveBeenCalled();
    expect(elasticState.reindex).toHaveBeenCalledWith({
      source: { index: "old-index" },
      dest: { index: expect.stringMatching(/^old-index_\d+$/) },
      wait_for_completion: true,
      conflicts: "proceed",
    });
    expect(elasticState.count).toHaveBeenCalledTimes(2);
    expect(elasticState.indices.updateAliases).toHaveBeenCalled();
  });

  it("should successfully reindex with custom suffix", async () => {
    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
    });

    const createCall = elasticState.indices.create.mock.calls[0][0];
    expect(createCall.index).toBe("old-index_v2");

    expect(elasticState.reindex).toHaveBeenCalledWith({
      source: { index: "old-index" },
      dest: { index: "old-index_v2" },
      wait_for_completion: true,
      conflicts: "proceed",
    });
  });

  it("should use custom settings when provided", async () => {
    const customSettings: estypes.IndicesIndexSettings = {
      number_of_shards: 5,
      number_of_replicas: 1,
    };

    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
      settings: customSettings,
    });

    expect(elasticState.indices.create).toHaveBeenCalledWith({
      index: "old-index_v2",
      mappings: testMappings,
      settings: customSettings,
    });
  });

  it("should throw error if source index does not exist", async () => {
    elasticState.indices.exists.mockResolvedValue(false);

    await expect(
      reindex.elasticReindex("non-existent", { mappings: testMappings })
    ).rejects.toThrow("Source index non-existent does not exist");

    expect(elasticState.indices.create).not.toHaveBeenCalled();
    expect(elasticState.reindex).not.toHaveBeenCalled();
  });

  it("should throw error if document counts do not match", async () => {
    elasticState.reindex.mockResolvedValue({
      total: 90,
      took: 1000,
      version_conflicts: 5,
    });
    elasticState.count
      .mockResolvedValueOnce({ count: 100 }) // source count
      .mockResolvedValueOnce({ count: 90 }); // dest count (expected 95 = 100 - 5 conflicts)

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Document count mismatch: expected 95 (100 source - 5 conflicts) but got 90");
  });

  it("should atomically swap indices with alias when keepOldIndex=false", async () => {
    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
      keepOldIndex: false,
    });

    expect(elasticState.indices.updateAliases).toHaveBeenCalledWith({
      actions: [
        { remove_index: { index: "old-index" } },
        { add: { index: "old-index_v2", alias: "old-index" } },
      ],
    });
  });

  it("should preserve old index when keepOldIndex=true", async () => {
    elasticState.indices.putAlias.mockResolvedValue({ acknowledged: true });
    elasticState.indices.updateAliases.mockResolvedValue({ acknowledged: true });

    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
      keepOldIndex: true,
    });

    // Should first create backup alias
    expect(elasticState.indices.putAlias).toHaveBeenCalledWith({
      index: "old-index",
      name: "old-index_old_v2",
    });

    // Then do atomic swap with remove_index (old index still accessible via backup alias)
    expect(elasticState.indices.updateAliases).toHaveBeenCalledWith({
      actions: [
        { remove_index: { index: "old-index" } },
        { add: { index: "old-index_v2", alias: "old-index" } },
      ],
    });
  });

  it("should throw error if alias swap is not acknowledged", async () => {
    elasticState.indices.updateAliases.mockResolvedValue({
      acknowledged: false,
    });

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Failed to swap old-index to old-index_v2");
  });

  it("should clean up new index on failure during create", async () => {
    const error = new Error("Create failed");
    elasticState.indices.create.mockRejectedValue(error);
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(false); // new index doesn't exist for cleanup

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Create failed");

    // Should check if new index exists for cleanup
    expect(elasticState.indices.exists).toHaveBeenCalledWith({
      index: "old-index_v2",
    });
  });

  it("should clean up new index on failure during reindex", async () => {
    const error = new Error("Reindex failed");
    elasticState.reindex.mockRejectedValue(error);
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(true); // new index exists for cleanup
    elasticState.indices.delete.mockResolvedValue({
      acknowledged: true,
    });

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Reindex failed");

    // Should delete the new index
    expect(elasticState.indices.delete).toHaveBeenCalledWith({
      index: "old-index_v2",
    });
  });

  it("should clean up new index on failure during document count validation", async () => {
    elasticState.count
      .mockResolvedValueOnce({ count: 100 })
      .mockResolvedValueOnce({ count: 50 });
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(true); // new index exists for cleanup
    elasticState.indices.delete.mockResolvedValue({
      acknowledged: true,
    });

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Document count mismatch");

    expect(elasticState.indices.delete).toHaveBeenCalledWith({
      index: "old-index_v2",
    });
  });

  it("should handle cleanup failure gracefully", async () => {
    const reindexError = new Error("Reindex failed");
    const cleanupError = new Error("Cleanup failed");

    elasticState.reindex.mockRejectedValue(reindexError);
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(true); // new index exists for cleanup
    elasticState.indices.delete.mockRejectedValue(cleanupError);

    // Should throw the original reindex error, not the cleanup error
    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
      })
    ).rejects.toThrow("Reindex failed");
  });

  it("should successfully reindex with version conflicts", async () => {
    elasticState.reindex.mockResolvedValue({
      total: 95,
      took: 1500,
      version_conflicts: 5,
    });
    elasticState.count
      .mockResolvedValueOnce({ count: 100 }) // source count
      .mockResolvedValueOnce({ count: 95 }); // dest count (valid: 100 - 5 conflicts = 95)

    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
    });

    expect(elasticState.count).toHaveBeenCalledTimes(2);
    // Should succeed because destCount (95) matches expected (100 - 5 = 95)
  });

  it("should throw error if putAlias fails during keepOldIndex", async () => {
    const error = new Error("putAlias failed");
    elasticState.indices.putAlias.mockRejectedValue(error);
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(true); // new index exists for cleanup
    elasticState.indices.delete.mockResolvedValue({ acknowledged: true });

    await expect(
      reindex.elasticReindex("old-index", {
        mappings: testMappings,
        suffix: "v2",
        keepOldIndex: true,
      })
    ).rejects.toThrow("putAlias failed");

    // Should cleanup the new index
    expect(elasticState.indices.delete).toHaveBeenCalledWith({
      index: "old-index_v2",
    });
  });

  it("should not call putAlias when keepOldIndex=false", async () => {
    await reindex.elasticReindex("old-index", {
      mappings: testMappings,
      suffix: "v2",
      keepOldIndex: false,
    });

    expect(elasticState.indices.putAlias).not.toHaveBeenCalled();
  });

  it("should wrap non-Error exceptions during reindex", async () => {
    elasticState.reindex.mockRejectedValue("String error");
    elasticState.indices.exists.mockResolvedValueOnce(true); // source exists
    elasticState.indices.exists.mockResolvedValueOnce(false); // new index doesn't exist

    await expect(
      reindex.elasticReindex("old-index", { mappings: testMappings })
    ).rejects.toThrow("Error during reindex from old-index to");
  });
});
