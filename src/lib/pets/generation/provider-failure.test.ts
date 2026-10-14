import { describe, expect, it } from "vitest";
import { readProviderFailure } from "./provider-failure";

describe("safe provider diagnostic contract", () => {
  it("never persists arbitrary strings even when they resemble identifiers", () => {
    expect(readProviderFailure({ httpStatus: 401, code: "private_prompt_secret", url: "https://private.invalid", message: "secret" }))
      .toEqual({ httpStatus: 401, code: "unrecognized" });
    expect(readProviderFailure({ httpStatus: 400, moderationStage: { toString() { throw new Error("must not execute"); } } }))
      .toEqual({ httpStatus: 400 });
  });
  it("does not invent an HTTP status for network and malformed failures", () => {
    for (const input of [undefined, {}, { httpStatus: "403" }, { httpStatus: 200 }, { httpStatus: 600 }]) {
      expect(readProviderFailure(input)).toBeUndefined();
    }
  });
});
