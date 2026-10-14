import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError } from "@/lib/pets/generation/model";
import { publicGenerationError } from "@/lib/pets/generation/public-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn(), readArtifact: vi.fn(), metrics: vi.fn() }));
vi.mock("@/lib/pets/generation/service", () => ({ petGeneration: { get: mocks.get, generate: mocks.generate } }));
vi.mock("@/lib/pets/generation/store", () => ({ generationStore: { readArtifact: mocks.readArtifact } }));
vi.mock("@/lib/metrics/yandex-measurement", () => ({ trackMcpToolCall: mocks.metrics }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("generation HTTP and MCP boundaries", () => {
  it("returns the same actionable failed-job description over HTTP and MCP without starting generation", async () => {
    const { GET } = await import("@/app/api/pet-generations/[id]/route");
    const { POST } = await import("@/app/mcp/route");
    const generation = { generationId: "a".repeat(64), status: "failed",
      error: publicGenerationError("provider_rejected", { httpStatus: 400, code: "moderation_blocked", moderationStage: "output" }) };
    mocks.get.mockResolvedValue(generation);
    const http = await GET(new Request("https://pets.example/result"), { params: Promise.resolve({ id: generation.generationId }) });
    expect(http.status).toBe(200); expect(await http.json()).toEqual({ generation });
    expect(http.headers.get("cache-control")).toContain("no-store");
    const rpc = await POST(new Request("https://pets.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_pet_generation", arguments: { generationId: generation.generationId } } }),
    }));
    const { result } = await rpc.json();
    expect(result.structuredContent).toEqual({ generation });
    expect(JSON.parse(result.content[0].text)).toEqual({ generation });
    // Reading a failed job is a successful read; only invocation failures set isError.
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result)).toContain("No image was returned");
    expect(JSON.stringify(result)).not.toMatch(/providerFailure|httpStatus|moderationStage/);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each(["ip", "global"] as const)("returns the same %s quota scope over HTTP and MCP", async limitScope => {
    const { POST: httpPost } = await import("@/app/api/pet-generations/route");
    const { POST: mcpPost } = await import("@/app/mcp/route");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    mocks.generate.mockRejectedValue(new GenerationError("rate_limited", "2026-10-11T21:00:00.000Z", undefined, limitScope));
    const args={prompt:"Synthetic",requestId:"a36caa99-c2cd-453b-8574-794452c94c5f"};
    const http=await httpPost(new Request("https://pets.example/api/pet-generations", {method:"POST", headers:{origin:"https://pets.example","content-type":"application/json","x-pets-client-ip":"203.0.113.5"}, body:JSON.stringify(args)}));
    expect(http.status).toBe(429);const body=await http.json();expect(body).toMatchObject({code:"rate_limited",limitScope,retryAt:"2026-10-11T21:00:00.000Z"});
    const rpc=await mcpPost(new Request("https://pets.example/mcp", {method:"POST",headers:{"content-type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"generate_pet",arguments:args}})}));
    const result=(await rpc.json()).result;expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({code:body.code,message:body.message,limitScope,retryAt:body.retryAt});
  });
  it("makes MCP invocation failures readable while preserving code and retryAt", async () => {
    const { POST } = await import("@/app/mcp/route");
    mocks.generate.mockRejectedValueOnce(new GenerationError("rate_limited", "2026-10-11T21:00:00.000Z"));
    const response = await POST(new Request("https://pets.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "generate_pet", arguments: { prompt: "synthetic", requestId: "a36caa99-c2cd-453b-8574-794452c94c5f" } } }),
    }));
    const { result } = await response.json();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: "rate_limited", message: "The daily generation limit has been reached.", automaticRetry: false, retryAt: "2026-10-11T21:00:00.000Z" });
    expect(result.structuredContent.error.hint).toContain("midnight Moscow time");
  });
  it("does not expose unexpected exception text through HTTP or MCP", async () => {
    const { GET } = await import("@/app/api/pet-generations/[id]/route");
    const { POST } = await import("@/app/mcp/route");
    mocks.get.mockRejectedValue(new Error("PRIVATE_PROMPT_AND_KEY"));
    const http = await GET(new Request("https://pets.example/result"), { params: Promise.resolve({ id: "a".repeat(64) }) });
    const body = await http.json();
    expect(body).toMatchObject({ code: "generation_unavailable", message: "Generation could not be completed or confirmed." });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_PROMPT_AND_KEY");
    const rpc = await POST(new Request("https://pets.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_pet_generation", arguments: { generationId: "a".repeat(64) } } }),
    }));
    const { result } = await rpc.json();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: "generation_unavailable", automaticRetry: false });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROMPT_AND_KEY");
  });
  it("passes only the nginx IP to the generation service and emits metadata-only metrics", async () => {
    const { POST } = await import("@/app/mcp/route");
    const args = { prompt: "Private fox description", requestId: "a36caa99-c2cd-453b-8574-794452c94c5f" };
    mocks.generate.mockResolvedValue({ generationId: "a".repeat(64), status: "queued" });
    const response = await POST(new Request("https://pets.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", Accept: "application/json, text/event-stream", "x-pets-client-ip": "203.0.113.10", "x-forwarded-for": "1.1.1.1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "generate_pet", arguments: args } }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).result.structuredContent.generation.status).toBe("queued");
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(args, "203.0.113.10");
    expect(mocks.metrics).toHaveBeenCalledExactlyOnceWith({ tool: "generate_pet", status: "success" });
  });
  it("does not expose raw source images or read files before completion", async () => {
    const { GET } = await import("@/app/api/pet-generations/[id]/files/[file]/route");
    const request = new Request("https://pets.example/file");
    const raw = await GET(request, { params: Promise.resolve({ id: "a".repeat(64), file: "source.png" }) });
    expect(raw.status).toBe(404); expect(mocks.readArtifact).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ status: "generating" });
    expect((await GET(request, { params: Promise.resolve({ id: "a".repeat(64), file: "pet.zip" }) })).status).toBe(404);
    expect(mocks.readArtifact).not.toHaveBeenCalled();
  });
  it("enforces expiry even while physical TTL cleanup has not run", async () => {
    const { GET } = await import("@/app/api/pet-generations/[id]/files/[file]/route");
    mocks.get.mockRejectedValue(new GenerationError("generation_expired"));
    const response = await GET(new Request("https://pets.example/file"), { params: Promise.resolve({ id: "a".repeat(64), file: "pet.zip" }) });
    expect(response.status).toBe(410); expect(mocks.readArtifact).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("serves only the expected completed file without download-counter mutations", async () => {
    const { GET } = await import("@/app/api/pet-generations/[id]/files/[file]/route");
    mocks.get.mockResolvedValue({ status: "completed" }); mocks.readArtifact.mockResolvedValue(Buffer.from("zip"));
    const response = await GET(new Request("https://pets.example/file"), { params: Promise.resolve({ id: "a".repeat(64), file: "pet.zip" }) });
    expect(response.status).toBe(200); expect(await response.text()).toBe("zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="pet.zip"');
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
});

describe("browser generation admission", () => {
  it("uses the same service/IP boundary as MCP and returns a private result", async () => {
    const { POST } = await import("@/app/api/pet-generations/route");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const args = { prompt: "Private fox", requestId: "a36caa99-c2cd-453b-8574-794452c94c5f" };
    mocks.generate.mockResolvedValue({ generationId: "b".repeat(64), status: "queued" });
    const response = await POST(new Request("https://pets.example/api/pet-generations", { method: "POST", headers: { Origin: "https://pets.example", "Content-Type": "application/json", "x-pets-client-ip": "203.0.113.10", "x-forwarded-for": "1.1.1.1" }, body: JSON.stringify(args) }));
    expect(response.status).toBe(202);
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(args, "203.0.113.10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
  it("rejects cross-site, oversized and malformed bodies before admission", async () => {
    const { POST } = await import("@/app/api/pet-generations/route");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    for (const [origin, body, expected] of [["https://evil.example", "{}", 403], ["https://pets.example", "x".repeat(17000), 413], ["https://pets.example", "{", 400]] as const) {
      const response = await POST(new Request("https://pets.example/api/pet-generations", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body }));
      expect(response.status).toBe(expected);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("returns a conflict for changed idempotent content and a rate limit for budget", async () => {
    const { POST } = await import("@/app/api/pet-generations/route");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    for (const [code, status] of [["request_id_conflict",409],["budget_exhausted",429],["queue_full",429]] as const) {
      mocks.generate.mockRejectedValueOnce(new GenerationError(code));
      const response = await POST(new Request("https://pets.example/api/pet-generations", { method:"POST", headers:{Origin:"https://pets.example","Content-Type":"application/json"},body:"{}" }));
      expect(response.status).toBe(status);
    }
  });
});
