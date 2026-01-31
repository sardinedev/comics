import { vi } from "vitest";

const elasticState = {
  search: vi.fn(),
  mget: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
  return {
    Client: class {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) { }
      search = (...args: any[]) => elasticState.search(...args);
      mget = (...args: any[]) => elasticState.mget(...args);
      indices = {
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn(),
      };
    },
  };
});

const elastic = await import("./elastic");


