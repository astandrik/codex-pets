import { beforeEach, describe, expect, it, vi } from "vitest";

describe("MCP Origin validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("allows absent and configured origins", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const { isAllowedMcpOrigin } = await import("@/lib/pets/mcp-origin");

    expect(isAllowedMcpOrigin(null)).toBe(true);
    expect(isAllowedMcpOrigin("https://pets.example")).toBe(true);
  });

  it("allows localhost origins outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const { isAllowedMcpOrigin } = await import("@/lib/pets/mcp-origin");

    expect(isAllowedMcpOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedMcpOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects unknown origins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const { isAllowedMcpOrigin } = await import("@/lib/pets/mcp-origin");

    expect(isAllowedMcpOrigin("https://evil.example")).toBe(false);
    expect(isAllowedMcpOrigin("not a url")).toBe(false);
  });
});
