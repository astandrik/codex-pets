import { afterEach, describe, expect, it, vi } from "vitest";

const COLLECT_URL = "https://mc.yandex.ru/collect";

describe("trackMcpToolCall", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does nothing when Measurement Protocol env is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { trackMcpToolCall } = await import("@/lib/metrics/yandex-measurement");

    await trackMcpToolCall({
      tool: "search_pets",
      status: "success",
      kind: "all",
      hasQuery: false,
      resultCount: 0,
      limit: 10,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a pageview before the MCP tool call event", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    vi.stubEnv("YANDEX_METRIKA_MP_TOKEN", "metric-secret");
    vi.stubEnv("YANDEX_METRIKA_MP_CLIENT_ID", "technical-client-id");
    const { trackMcpToolCall } = await import("@/lib/metrics/yandex-measurement");

    await trackMcpToolCall({
      tool: "search_pets",
      status: "success",
      kind: "all",
      hasQuery: true,
      resultCount: 5,
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(COLLECT_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(COLLECT_URL);

    const pageview = collectBody(fetchMock, 0);
    expect(pageview.get("tid")).toBe("104844437");
    expect(pageview.get("cid")).toBe("technical-client-id");
    expect(pageview.get("t")).toBe("pageview");
    expect(pageview.get("dl")).toBe("https://pets.example/codex-pets/mcp");
    expect(pageview.get("dt")).toBe("Codex Pets MCP");
    expect(pageview.get("dr")).toBe("https://pets.example/codex-pets");
    expect(pageview.get("ms")).toBe("metric-secret");

    const event = collectBody(fetchMock, 1);
    expect(event.get("tid")).toBe("104844437");
    expect(event.get("cid")).toBe("technical-client-id");
    expect(event.get("t")).toBe("event");
    expect(event.get("ea")).toBe("mcp_tool_call");
    expect(event.get("dl")).toBe("https://pets.example/codex-pets/mcp");
    expect(event.get("ms")).toBe("metric-secret");

    const params = JSON.parse(event.get("params") ?? "{}");
    expect(params).toEqual({
      mcp: {
        tool: "search_pets",
        status: "success",
        kind: "all",
        hasQuery: true,
        resultCount: 5,
        limit: 5,
      },
    });
    expect(JSON.stringify(params)).not.toMatch(
      /space|origin|user-agent|ipAddress|contact|owner/i,
    );
  });

  it("does not throw when fetch rejects", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    stubConfiguredMeasurementEnv();
    const { trackMcpToolCall } = await import("@/lib/metrics/yandex-measurement");

    await expect(
      trackMcpToolCall({
        tool: "get_pet",
        status: "success",
        slug: "orbit-otter",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when requests time out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    stubConfiguredMeasurementEnv();
    const { trackMcpToolCall } = await import("@/lib/metrics/yandex-measurement");

    const promise = trackMcpToolCall({
      tool: "get_pet",
      status: "success",
      slug: "orbit-otter",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function stubConfiguredMeasurementEnv(): void {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.stubEnv("YANDEX_METRIKA_MP_TOKEN", "metric-secret");
  vi.stubEnv("YANDEX_METRIKA_MP_CLIENT_ID", "technical-client-id");
}

function collectBody(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  callIndex: number,
): URLSearchParams {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  expect(init?.method).toBe("POST");
  expect(init?.headers).toEqual({
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  });
  expect(init?.body).toBeInstanceOf(URLSearchParams);
  return init?.body as URLSearchParams;
}
