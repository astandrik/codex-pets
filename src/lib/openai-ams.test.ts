import {EventEmitter} from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAMSOpenAIJSONTransport, resolveOpenAIAMSOperation, validateAMSProxy } from "@/lib/openai-ams";

const network = vi.hoisted(() => ({
  request: vi.fn<() => unknown>(() => { throw new Error("network_forbidden_in_test"); }),
  tlsConnect: vi.fn(),
}));
vi.mock("node:http", () => ({request: network.request}));
vi.mock("node:tls", () => ({connect: network.tlsConnect}));

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

it.each(["connect", "tls"])("preserves the %s timeout before sending an OpenAI request", async phase => {
  vi.useFakeTimers();
  try {
    const connect = Object.assign(new EventEmitter(), {
      end: () => {},
      destroy(this: EventEmitter, error: Error) { this.emit("error", error); },
    });
    const encrypted = Object.assign(new EventEmitter(), {
      destroy(this: EventEmitter, error: Error) { this.emit("error", error); },
    });
    network.request.mockReturnValueOnce(connect);
    network.tlsConnect.mockReturnValueOnce(encrypted);
    const transport = createAMSOpenAIJSONTransport("synthetic-key", "http://172.17.0.1:18090");
    const outcome = transport("responses", {}).then(() => null, (error: unknown) => error);
    if (phase === "tls") connect.emit("connect", {statusCode: 200}, {}, Buffer.alloc(0));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toMatchObject({message: "openai_ams_" + phase + "_timeout"});
  } finally {
    vi.useRealTimers();
    network.tlsConnect.mockReset();
  }
});
