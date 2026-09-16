import { describe, expect, it } from "vitest";
import { constantTimeEqual, sha256Hex } from "../src/worker/security";

describe("security helpers", () => {
  it("hashes tokens and compares admin secrets", async () => {
    expect(await sha256Hex("token")).toHaveLength(64);
    await expect(constantTimeEqual("secret", "secret")).resolves.toBe(true);
    await expect(constantTimeEqual("secret", "different")).resolves.toBe(false);
  });
});
