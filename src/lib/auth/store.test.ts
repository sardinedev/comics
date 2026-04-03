import { describe, it, expect, vi, beforeEach } from "vitest";

const elasticMock = {
  get: vi.fn(),
  index: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@data/elastic/elastic", () => ({
  elastic: elasticMock,
}));

vi.mock("@data/elastic/models/oauth-store.model", () => ({
  OAUTH_STORE_INDEX: "test_oauth_store",
}));

const { ElasticKeyedStore } = await import("./store");

describe("ElasticKeyedStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("returns the stored data when the document exists", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.get.mockResolvedValue({ _source: { data: { token: "abc" } } });

      const result = await store.get("key1");

      expect(result).toEqual({ token: "abc" });
      expect(elasticMock.get).toHaveBeenCalledWith({
        index: "test_oauth_store",
        id: "state:key1",
      });
    });

    it("uses the prefix to namespace the key", async () => {
      const store = new ElasticKeyedStore("session");
      elasticMock.get.mockResolvedValue({ _source: { data: {} } });

      await store.get("key1");

      expect(elasticMock.get).toHaveBeenCalledWith(
        expect.objectContaining({ id: "session:key1" })
      );
    });

    it("returns undefined when the document is not found (ES throws)", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.get.mockRejectedValue({ statusCode: 404 });

      const result = await store.get("missing");

      expect(result).toBeUndefined();
    });

    it("returns undefined on any Elasticsearch error", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.get.mockRejectedValue(new Error("Connection refused"));

      const result = await store.get("key1");

      expect(result).toBeUndefined();
    });

    it("returns undefined when _source is absent", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.get.mockResolvedValue({ _source: undefined });

      const result = await store.get("key1");

      expect(result).toBeUndefined();
    });
  });

  describe("set", () => {
    it("indexes the document with the prefixed key", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.index.mockResolvedValue({ result: "created" });

      await store.set("key1", { token: "abc" });

      expect(elasticMock.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "test_oauth_store",
          id: "state:key1",
          document: expect.objectContaining({ data: { token: "abc" } }),
        })
      );
    });

    it("sets refresh: true to ensure immediate read-your-writes consistency", async () => {
      const store = new ElasticKeyedStore("session");
      elasticMock.index.mockResolvedValue({ result: "created" });

      await store.set("key1", {});

      expect(elasticMock.index).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: true })
      );
    });

    it("stores an updated_at ISO timestamp", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.index.mockResolvedValue({ result: "created" });

      await store.set("key1", {});

      const doc = elasticMock.index.mock.calls[0][0].document;
      expect(doc.updated_at).toBeDefined();
      expect(new Date(doc.updated_at).toISOString()).toBe(doc.updated_at);
    });
  });

  describe("del", () => {
    it("deletes the document by prefixed key", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.delete.mockResolvedValue({ result: "deleted" });

      await store.del("key1");

      expect(elasticMock.delete).toHaveBeenCalledWith({
        index: "test_oauth_store",
        id: "state:key1",
      });
    });

    it("uses the prefix to namespace the key", async () => {
      const store = new ElasticKeyedStore("session");
      elasticMock.delete.mockResolvedValue({ result: "deleted" });

      await store.del("key1");

      expect(elasticMock.delete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "session:key1" })
      );
    });

    it("silently ignores not-found errors", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.delete.mockRejectedValue({ statusCode: 404 });

      await expect(store.del("missing")).resolves.toBeUndefined();
    });

    it("silently ignores any Elasticsearch error", async () => {
      const store = new ElasticKeyedStore("state");
      elasticMock.delete.mockRejectedValue(new Error("Connection refused"));

      await expect(store.del("key1")).resolves.toBeUndefined();
    });
  });
});
