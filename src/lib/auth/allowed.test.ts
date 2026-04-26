import { describe, expect, it, vi } from "vitest";

import { getAllowedDids } from "./allowed";

describe("getAllowedDids", () => {
  it("returns an empty array when the env var is not set", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", undefined as unknown as string);
    expect(getAllowedDids()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("returns an empty array when the env var is empty", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", "");
    expect(getAllowedDids()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("returns an empty array when the env var is whitespace/commas only", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", " , ,, ");
    expect(getAllowedDids()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("returns a single DID", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", "did:plc:abc");
    expect(getAllowedDids()).toEqual(["did:plc:abc"]);
    vi.unstubAllEnvs();
  });

  it("returns multiple DIDs from a comma-separated list", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", "did:plc:abc,did:plc:def");
    expect(getAllowedDids()).toEqual(["did:plc:abc", "did:plc:def"]);
    vi.unstubAllEnvs();
  });

  it("trims whitespace and drops empty entries", () => {
    vi.stubEnv("AUTH_ALLOWED_DID", " did:plc:abc , ,did:plc:def , ");
    expect(getAllowedDids()).toEqual(["did:plc:abc", "did:plc:def"]);
    vi.unstubAllEnvs();
  });
});
