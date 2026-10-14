import { describe, expect, it, vi } from "vitest";
import { createAMSOpenAIJSONTransport, resolveOpenAIAMSOperation, validateAMSProxy } from "@/lib/openai-ams";

const network = vi.hoisted(() => ({ request: vi.fn(() => { throw new Error("network_forbidden_in_test"); }) }));
vi.mock("node:http", () => network);

describe("fixed private AMS destinations", () => {
  it("accepts only the existing private proxy and three fixed operations", () => {
    expect(validateAMSProxy("http://172.17.0.1:18089").hostname).toBe("172.17.0.1");
    expect(validateAMSProxy("http://172.17.0.1:18090").port).toBe("18090");
    for (const value of ["https://api.openai.com", "http://localhost:18089", "http://user:pass@172.17.0.1:18089", "http://172.17.0.1:18089/path"]) {
      expect(() => validateAMSProxy(value)).toThrow();
    }
    expect(resolveOpenAIAMSOperation("responses")).toEqual({ method: "POST", path: "/v1/responses", timeout: 180000 });
    expect(resolveOpenAIAMSOperation("metadata-model").path).toBe("/v1/models/gpt-6.1-sol");
    expect(() => Reflect.apply(resolveOpenAIAMSOperation, null, ["https://elsewhere"])).toThrow();
  });
  it("rejects invalid input before any network access", async () => {
    const transport = createAMSOpenAIJSONTransport("synthetic-key", "http://172.17.0.1:18089");
    await expect(transport("metadata-model", {})).rejects.toThrow("get_body_forbidden");
    await expect(transport("responses", "x".repeat(2 * 1024 * 1024))).rejects.toThrow("request_invalid");
    expect(network.request).not.toHaveBeenCalled();
  });
});
