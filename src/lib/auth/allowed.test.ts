import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL = process.env.AUTH_ALLOWED_DID;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_ALLOWED_DID;
  else process.env.AUTH_ALLOWED_DID = ORIGINAL;
});

async function loadFresh() {
  // env() reads process.env at call time, so re-import isn't required, but
  // keep this helper for clarity if that changes.
  return await import("./allowed");
}

describe("getAllowedDids", () => {
  it("returns an empty array when the env var is not set", async () => {
    delete process.env.AUTH_ALLOWED_DID;
    const { getAllowedDids } = await loadFresh();
    expect(getAllowedDids()).toEqual([]);
  });

  it("returns an empty array when the env var is empty", async () => {
    process.env.AUTH_ALLOWED_DID = "";
    const { getAllowedDids } = await loadFresh();
    expect(getAllowedDids()).toEqual([]);
  });

  it("returns a single DID", async () => {
    process.env.AUTH_ALLOWED_DID = "did:plc:abc";
    const { getAllowedDids } = await loadFresh();
    expect(getAllowedDids()).toEqual(["did:plc:abc"]);
  });

  it("returns multiple DIDs from a comma-separated list", async () => {
    process.env.AUTH_ALLOWED_DID = "did:plc:abc,did:plc:def";
    const { getAllowedDids } = await loadFresh();
    expect(getAllowedDids()).toEqual(["did:plc:abc", "did:plc:def"]);
  });

  it("trims whitespace and drops empty entries", async () => {
    process.env.AUTH_ALLOWED_DID = " did:plc:abc , ,did:plc:def , ";
    const { getAllowedDids } = await loadFresh();
    expect(getAllowedDids()).toEqual(["did:plc:abc", "did:plc:def"]);
  });
});

describe("isAllowedDid", () => {
  it("returns false for null/undefined/empty input", async () => {
    process.env.AUTH_ALLOWED_DID = "did:plc:abc";
    const { isAllowedDid } = await loadFresh();
    expect(isAllowedDid(null)).toBe(false);
    expect(isAllowedDid(undefined)).toBe(false);
    expect(isAllowedDid("")).toBe(false);
  });

  it("returns false when no DIDs are configured", async () => {
    delete process.env.AUTH_ALLOWED_DID;
    const { isAllowedDid } = await loadFresh();
    expect(isAllowedDid("did:plc:abc")).toBe(false);
  });

  it("returns true when the DID matches the single configured DID", async () => {
    process.env.AUTH_ALLOWED_DID = "did:plc:abc";
    const { isAllowedDid } = await loadFresh();
    expect(isAllowedDid("did:plc:abc")).toBe(true);
    expect(isAllowedDid("did:plc:other")).toBe(false);
  });

  it("returns true for any DID in the comma-separated list", async () => {
    process.env.AUTH_ALLOWED_DID = "did:plc:abc, did:plc:def";
    const { isAllowedDid } = await loadFresh();
    expect(isAllowedDid("did:plc:abc")).toBe(true);
    expect(isAllowedDid("did:plc:def")).toBe(true);
    expect(isAllowedDid("did:plc:nope")).toBe(false);
  });
});
