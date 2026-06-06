import { describe, expect, it, vi } from "vitest";

import {
  appendAgentLinkHeaders,
  getAgentLinkHeaderForPath,
} from "@/lib/agent-link-headers";

describe("agent link headers", () => {
  it("builds sitemap, describedby, service-desc, and MCP service links for HTML pages", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const header = getAgentLinkHeaderForPath("/");

    expect(header).toContain('<https://pets.example/sitemap.xml>; rel="sitemap"');
    expect(header).toContain('<https://pets.example/llms.txt>; rel="describedby"');
    expect(header).toContain('<https://pets.example/openapi.json>; rel="service-desc"');
    expect(header).toContain('<https://pets.example/mcp>; rel="service"');

    vi.unstubAllEnvs();
  });

  it("advertises markdown and scoped llms alternates for agent pages", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const agentsHeader = getAgentLinkHeaderForPath("/agents");
    const developersHeader = getAgentLinkHeaderForPath("/developers");
    const docsHeader = getAgentLinkHeaderForPath("/docs/api");

    expect(agentsHeader).toContain(
      '<https://pets.example/agents.md>; rel="alternate"; type="text/markdown"',
    );
    expect(developersHeader).toContain(
      '<https://pets.example/developers/llms.txt>; rel="describedby"; type="text/plain"',
    );
    expect(docsHeader).toContain(
      '<https://pets.example/docs/llms.txt>; rel="describedby"; type="text/plain"',
    );

    vi.unstubAllEnvs();
  });

  it("advertises markdown alternates for guide pages", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const header = getAgentLinkHeaderForPath(
      "/guides/best-codex-pets-for-ai-coding-agents",
    );

    expect(header).toContain(
      '<https://pets.example/guides/best-codex-pets-for-ai-coding-agents.md>; rel="alternate"; type="text/markdown"',
    );

    vi.unstubAllEnvs();
  });

  it("appends agent discovery links to an existing response", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const response = new Response("ok", {
      headers: {
        Link: '<https://assets.example/feed>; rel="alternate"',
      },
    });

    appendAgentLinkHeaders(response.headers, "/docs/api");

    expect(response.headers.get("Link")).toContain(
      '<https://assets.example/feed>; rel="alternate"',
    );
    expect(response.headers.get("Link")).toContain(
      '<https://pets.example/openapi.json>; rel="service-desc"',
    );

    vi.unstubAllEnvs();
  });
});
