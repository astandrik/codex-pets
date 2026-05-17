import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
  getApprovedPetBySlug: vi.fn(),
}));

const metricsMocks = vi.hoisted(() => ({
  trackMcpToolCall: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
  getApprovedPetBySlug: repositoryMocks.getApprovedPetBySlug,
}));

vi.mock("@/lib/metrics/yandex-measurement", () => ({
  trackMcpToolCall: metricsMocks.trackMcpToolCall,
}));

const approvedPet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "A compact space helper.",
  spritesheetUrl: "/api/assets/a/spritesheet.webp",
  petJsonUrl: "/api/assets/a/pet.json",
  zipUrl: "/api/assets/a/pet.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space", "friendly"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: "private@example.com",
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 7,
  installCount: 3,
  likeCount: 1,
};

describe("POST /mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("handles initialize", async () => {
    const body = await callMcp({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "vitest",
          version: "0.0.0",
        },
      },
    });

    expect(body.result.serverInfo).toMatchObject({
      name: "codex-pets-registry",
      version: "0.2.0",
    });
  });

  it("lists public tools", async () => {
    const body = await callMcp({
      id: 2,
      method: "tools/list",
    });

    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "search_pets",
      "get_pet",
      "get_install_instructions",
      "get_badge_code",
      "get_embed_code",
      "get_card_code",
      "get_pet_request_info",
    ]);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it("returns pet request workflow discovery", async () => {
    const body = await callMcp({
      id: 9,
      method: "tools/call",
      params: {
        name: "get_pet_request_info",
        arguments: {},
      },
    });

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.request.pageUrl).toContain("/request");
    expect(body.result.structuredContent.request.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "contactEmail", required: true }),
        expect.objectContaining({ name: "prompt", required: true }),
        expect.objectContaining({ name: "referenceImage", maxBytes: 5242880 }),
      ]),
    );
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: "get_pet_request_info",
      status: "success",
    });
  });

  it("calls search_pets", async () => {
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);

    const body = await callMcp({
      id: 3,
      method: "tools/call",
      params: {
        name: "search_pets",
        arguments: {
          query: "space",
          tags: ["friendly"],
          limit: 5,
        },
      },
    });

    expect(body.result.structuredContent.total).toBe(1);
    expect(body.result.structuredContent.pets[0].slug).toBe("orbit-otter");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain(
      "private@example.com",
    );
    expect(body.result.content[0].text).toContain('"orbit-otter"');
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: "search_pets",
      status: "success",
      kind: "all",
      hasQuery: true,
      resultCount: 1,
      limit: 5,
    });
  });

  it.each([
    ["get_pet", "pet"],
    ["get_install_instructions", "install"],
    ["get_badge_code", "badge"],
    ["get_embed_code", "embed"],
    ["get_card_code", "card"],
  ])("calls %s", async (toolName, expectedKey) => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);

    const body = await callMcp({
      id: 4,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {
          slug: "orbit-otter",
        },
      },
    });

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent[expectedKey]).toBeDefined();
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: toolName,
      status: "success",
      slug: "orbit-otter",
    });
  });

  it("returns structured tool errors and tracks invalid arguments", async () => {
    const body = await callMcp({
      id: 5,
      method: "tools/call",
      params: {
        name: "get_pet",
        arguments: {
          slug: "../admin",
        },
      },
    });

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toEqual({
      error: {
        code: "invalid_argument",
        message: "Invalid pet slug.",
      },
    });
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: "get_pet",
      status: "invalid_argument",
    });
    expect(metricsMocks.trackMcpToolCall.mock.calls[0]?.[0]).not.toHaveProperty(
      "slug",
    );
  });

  it("tracks missing approved pets as not_found", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(null);

    const body = await callMcp({
      id: 6,
      method: "tools/call",
      params: {
        name: "get_pet",
        arguments: {
          slug: "missing-pet",
        },
      },
    });

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("not_found");
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: "get_pet",
      status: "not_found",
      slug: "missing-pet",
    });
  });

  it("tracks unexpected tool errors before the SDK returns an error result", async () => {
    repositoryMocks.getApprovedPetBySlug.mockRejectedValueOnce(
      new Error("YDB unavailable"),
    );

    const body = await callMcp({
      id: 7,
      method: "tools/call",
      params: {
        name: "get_pet",
        arguments: {
          slug: "orbit-otter",
        },
      },
    });

    expect(body.result.isError).toBe(true);
    expect(metricsMocks.trackMcpToolCall).toHaveBeenCalledWith({
      tool: "get_pet",
      status: "error",
    });
  });

  it("rejects forbidden origins before MCP handling", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const { POST } = await import("@/app/mcp/route");

    const response = await POST(
      mcpRequest(
        {
          id: 8,
          method: "tools/list",
        },
        {
          origin: "https://evil.example",
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.message).toBe("Forbidden origin.");
  });
});

describe("GET /mcp", () => {
  it("returns a JSON-RPC 405 error", async () => {
    const { GET } = await import("@/app/mcp/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(body).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });
});

async function callMcp(message: {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}) {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  const { POST } = await import("@/app/mcp/route");
  const response = await POST(mcpRequest(message));
  expect(response.status).toBe(200);
  return response.json();
}

function mcpRequest(
  message: {
    id: number;
    method: string;
    params?: Record<string, unknown>;
  },
  headers: Record<string, string> = {},
): Request {
  return new Request("https://pets.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...message,
    }),
  });
}
