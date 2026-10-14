import { describe, expect, it } from "vitest";
import { publicGenerationError } from "./public-error";

describe("public generation failure descriptions", () => {
  it.each(["input", "output", "unknown"] as const)("describes known moderation at %s without guessing a category", stage => {
    const error = publicGenerationError("provider_rejected", { httpStatus: 400, code: "moderation_blocked", moderationStage: stage });
    expect(error).toMatchObject({ code: "provider_rejected", automaticRetry: false });
    expect(error.message).toContain(stage === "output" ? "generated image" : stage === "input" ? "generation request" : "this generation");
    expect(error.hint).toContain("choose to try again");
    expect(error).not.toHaveProperty("httpStatus");
    expect(error).not.toHaveProperty("moderationStage");
  });
  it("distinguishes IP and service caps without exposing the address", () => {
    const ip = publicGenerationError("rate_limited", undefined, "ip");
    const global = publicGenerationError("rate_limited", undefined, "global");
    expect(ip).toMatchObject({ code: "rate_limited", limitScope: "ip" });
    expect(ip.message).toContain("IP address"); expect(global.message).toContain("whole service");
    expect(global.limitScope).toBe("global");
    expect(publicGenerationError("rate_limited")).not.toHaveProperty("limitScope");
  });
  it("does not invent moderation for legacy refusals without diagnostics", () => {
    const error = publicGenerationError("provider_rejected");
    expect(error.message).toContain("do not identify the reason");
    expect(error.message).not.toContain("safety");
  });
  it("does not encourage another paid request when the previous outcome is unknown", () => {
    const error = publicGenerationError("outcome_unknown");
    expect(error.hint).toContain("Do not start another task");
    expect(error.automaticRetry).toBe(false);
  });
  it("distinguishes a parameter problem from moderation without exposing the rejected value", () => {
    const error = publicGenerationError("provider_rejected", { httpStatus: 400, code: "invalid_value" });
    expect(error.message).toContain("request parameters");
    expect(error.hint).toContain("administrator");
    expect(error.message).not.toContain("safety");
  });
  it.each(["queue_timeout", "invalid_sprite_extraction", "rate_limited", "budget_exhausted", "provider_rate_limited", "generation_expired"])("describes %s without changing its machine code", code => {
    expect(publicGenerationError(code)).toMatchObject({ code, automaticRetry: false });
    expect(publicGenerationError(code).message.length).toBeGreaterThan(20);
  });
  it("never echoes arbitrary error codes or unknown provider fields", () => {
    expect(JSON.stringify(publicGenerationError("sk-private-secret"))).not.toContain("sk-private-secret");
    expect(publicGenerationError("__proto__").code).toBe("generation_unavailable");
    const details = { httpStatus: 401, code: "invalid_api_key", message: "private prompt", apiKey: "sk-private", requestId: "req-private" };
    const error = publicGenerationError("provider_rejected", details);
    expect(error.hint).toContain("administrator");
    expect(JSON.stringify(error)).not.toMatch(/private prompt|sk-private|req-private|invalid_api_key|401/);
  });
});
