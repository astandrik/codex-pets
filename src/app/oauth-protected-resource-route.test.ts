import { describe, expect, it, vi } from "vitest";

describe("OAuth protected resource metadata routes", () => {
  it.each([
    {
      modulePath: "@/app/.well-known/oauth-protected-resource/route",
      resource: "https://pets.example/codex-pets",
      serviceDocumentation: "https://pets.example/codex-pets/developers",
    },
    {
      modulePath: "@/app/.well-known/oauth-protected-resource/mcp/route",
      resource: "https://pets.example/codex-pets/mcp",
      serviceDocumentation: "https://pets.example/codex-pets/mcp.md",
    },
  ])("serves $modulePath as protected resource metadata", async ({
    modulePath,
    resource,
    serviceDocumentation,
  }) => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { GET } = await import(modulePath);
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
    expect(body).toMatchObject({
      resource,
      resource_name: "Codex Pets",
      service_documentation: serviceDocumentation,
      policy_uri: "https://pets.example/codex-pets/terms",
      terms_of_service: "https://pets.example/codex-pets/terms",
    });
    expect(body.authorization_servers).toBeUndefined();
    expect(body.oauth_unsupported).toBe(true);

    vi.unstubAllEnvs();
  });
});
