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
const elastic = await import("./elastic");

describe("Elasticsearch Client Functions", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe("elasticIndexExists", () => {
    it("should return true when index exists", async () => {
      elasticState.indices.exists.mockResolvedValue(true);

      const result = await elastic.elasticIndexExists("test-index");

      expect(result).toBe(true);
      expect(elasticState.indices.exists).toHaveBeenCalledWith({
        index: "test-index",
      });
    });

    it("should return false when index does not exist", async () => {
      elasticState.indices.exists.mockResolvedValue(false);

      const result = await elastic.elasticIndexExists("non-existent-index");

      expect(result).toBe(false);
      expect(elasticState.indices.exists).toHaveBeenCalledWith({
        index: "non-existent-index",
      });
    });

    it("should propagate errors from Elasticsearch client", async () => {
      const error = new Error("Connection failed");
      elasticState.indices.exists.mockRejectedValue(error);

      await expect(elastic.elasticIndexExists("test-index")).rejects.toThrow(
        "Connection failed"
      );
    });
  });

  describe("elasticCreateIndex", () => {
    const testMappings: estypes.MappingTypeMapping = {
      properties: {
        title: { type: "text" },
        issue_number: { type: "integer" },
      },
    };

    it("should create index with default settings when settings not provided", async () => {
      elasticState.indices.create.mockResolvedValue({
        acknowledged: true,
        shards_acknowledged: true,
        index: "test-index",
      });

      await elastic.elasticCreateIndex("test-index", testMappings);

      expect(elasticState.indices.create).toHaveBeenCalledWith({
        index: "test-index",
        mappings: testMappings,
        settings: elastic.DEFAULT_INDEX_SETTINGS,
      });
    });

    it("should create index with custom settings when provided", async () => {
      const customSettings: estypes.IndicesIndexSettings = {
        number_of_shards: 2,
        number_of_replicas: 1,
      };

      elasticState.indices.create.mockResolvedValue({
        acknowledged: true,
        shards_acknowledged: true,
        index: "test-index",
      });

      await elastic.elasticCreateIndex("test-index", testMappings, customSettings);

      expect(elasticState.indices.create).toHaveBeenCalledWith({
        index: "test-index",
        mappings: testMappings,
        settings: customSettings,
      });
    });

    it("should throw error if response is not acknowledged", async () => {
      elasticState.indices.create.mockResolvedValue({
        acknowledged: false,
        shards_acknowledged: false,
      });

      await expect(
        elastic.elasticCreateIndex("test-index", testMappings)
      ).rejects.toThrow("Failed to create index test-index");
    });

    it("should handle and rethrow Elasticsearch errors", async () => {
      const error = new Error("Index already exists");
      elasticState.indices.create.mockRejectedValue(error);

      await expect(
        elastic.elasticCreateIndex("test-index", testMappings)
      ).rejects.toThrow("Index already exists");
    });

    it("should wrap non-Error exceptions with Error", async () => {
      elasticState.indices.create.mockRejectedValue("String error");

      await expect(
        elastic.elasticCreateIndex("test-index", testMappings)
      ).rejects.toThrow("Error creating index test-index");
    });
  });

  describe("elasticUpdateMappings", () => {
    const testMappings: estypes.MappingTypeMapping = {
      properties: {
        new_field: { type: "keyword" },
      },
    };

    it("should update index mappings successfully", async () => {
      elasticState.indices.putMapping.mockResolvedValue({
        acknowledged: true,
      });

      await elastic.elasticUpdateMappings("test-index", testMappings);

      expect(elasticState.indices.putMapping).toHaveBeenCalledWith({
        index: "test-index",
        properties: testMappings.properties,
      });
    });

    it("should throw error if response is not acknowledged", async () => {
      elasticState.indices.putMapping.mockResolvedValue({
        acknowledged: false,
      });

      await expect(
        elastic.elasticUpdateMappings("test-index", testMappings)
      ).rejects.toThrow("Failed to update mappings for index test-index");
    });

    it("should handle and rethrow Elasticsearch errors", async () => {
      const error = new Error("Mapping conflict");
      elasticState.indices.putMapping.mockRejectedValue(error);

      await expect(
        elastic.elasticUpdateMappings("test-index", testMappings)
      ).rejects.toThrow("Mapping conflict");
    });

    it("should wrap non-Error exceptions with Error", async () => {
      elasticState.indices.putMapping.mockRejectedValue("String error");

      await expect(
        elastic.elasticUpdateMappings("test-index", testMappings)
      ).rejects.toThrow("Error updating mappings for index test-index");
    });
  });

  describe("elasticDeleteIndex", () => {
    it("should delete index successfully", async () => {
      elasticState.indices.delete.mockResolvedValue({
        acknowledged: true,
      });

      await elastic.elasticDeleteIndex("test-index");

      expect(elasticState.indices.delete).toHaveBeenCalledWith({
        index: "test-index",
      });
    });

    it("should throw error if response is not acknowledged", async () => {
      elasticState.indices.delete.mockResolvedValue({
        acknowledged: false,
      });

      await expect(elastic.elasticDeleteIndex("test-index")).rejects.toThrow(
        "Failed to delete index test-index"
      );
    });

    it("should handle and rethrow Elasticsearch errors", async () => {
      const error = new Error("Index not found");
      elasticState.indices.delete.mockRejectedValue(error);

      await expect(elastic.elasticDeleteIndex("test-index")).rejects.toThrow(
        "Index not found"
      );
    });

    it("should wrap non-Error exceptions with Error", async () => {
      elasticState.indices.delete.mockRejectedValue("String error");

      await expect(elastic.elasticDeleteIndex("test-index")).rejects.toThrow(
        "Error deleting index test-index"
      );
    });
  });

  describe("elasticInitializeIndex", () => {
    const testMappings: estypes.MappingTypeMapping = {
      properties: {
        title: { type: "text" },
      },
    };

    it("should create index if it does not exist", async () => {
      elasticState.indices.exists.mockResolvedValue(false);
      elasticState.indices.create.mockResolvedValue({
        acknowledged: true,
        shards_acknowledged: true,
        index: "test-index",
      });

      await elastic.elasticInitializeIndex("test-index", testMappings);

      expect(elasticState.indices.exists).toHaveBeenCalledWith({
        index: "test-index",
      });
      expect(elasticState.indices.create).toHaveBeenCalledWith({
        index: "test-index",
        mappings: testMappings,
        settings: elastic.DEFAULT_INDEX_SETTINGS,
      });
      expect(elasticState.indices.putMapping).not.toHaveBeenCalled();
    });

    it("should update mappings if index exists", async () => {
      elasticState.indices.exists.mockResolvedValue(true);
      elasticState.indices.putMapping.mockResolvedValue({
        acknowledged: true,
      });

      await elastic.elasticInitializeIndex("test-index", testMappings);

      expect(elasticState.indices.exists).toHaveBeenCalledWith({
        index: "test-index",
      });
      expect(elasticState.indices.putMapping).toHaveBeenCalledWith({
        index: "test-index",
        properties: testMappings.properties,
      });
      expect(elasticState.indices.create).not.toHaveBeenCalled();
    });

    it("should pass custom settings when creating new index", async () => {
      const customSettings: estypes.IndicesIndexSettings = {
        number_of_shards: 3,
        number_of_replicas: 2,
      };

      elasticState.indices.exists.mockResolvedValue(false);
      elasticState.indices.create.mockResolvedValue({
        acknowledged: true,
        shards_acknowledged: true,
        index: "test-index",
      });

      await elastic.elasticInitializeIndex("test-index", testMappings, customSettings);

      expect(elasticState.indices.create).toHaveBeenCalledWith({
        index: "test-index",
        mappings: testMappings,
        settings: customSettings,
      });
    });
  });
});


