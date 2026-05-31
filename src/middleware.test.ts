import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("middleware markdown content negotiation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("sets Vary: Accept when rewriting a public URL to markdown", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/", {
      headers: {
        Accept: "text/markdown",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("Vary")).toBe("Accept");
  });

  it("does not rewrite to markdown when markdown is explicitly unacceptable", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/", {
      headers: {
        Accept: "text/html, text/markdown;q=0",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  it("does not rewrite to markdown when html has higher Accept priority", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/docs/api", {
      headers: {
        Accept: "text/html;q=1, text/markdown;q=0.1",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  it("rewrites to markdown when markdown has higher Accept priority", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/docs/api", {
      headers: {
        Accept: "text/html;q=0.1, text/markdown;q=1",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://pets.example/docs/api.md",
    );
  });

  it.each([
    ["/agents", "/agents.md"],
    ["/about", "/about.md"],
  ])("rewrites %s to its markdown twin", async (pathname, markdownPath) => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest(`https://pets.example${pathname}`, {
      headers: {
        Accept: "text/markdown",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://pets.example${markdownPath}`,
    );
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  it("sets Vary: Accept on HTML responses for markdown-negotiated URLs", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/developers", {
      headers: {
        Accept: "text/html",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("Vary")).toBe("Accept");
  });

  it("preserves the configured base path for markdown rewrites", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/codex-pets/", {
      headers: {
        Accept: "text/markdown",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://pets.example/codex-pets/index.md",
    );
  });

  it("normalizes base-path requests before adding agent Link headers", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/codex-pets/developers");

    const response = middleware(request);

    expect(response.headers.get("Link")).toContain(
      '<https://pets.example/codex-pets/llms.txt>; rel="describedby"',
    );
  });

  it.each([
    [
      "/.well-known/oauth-protected-resource/codex-pets",
      "/codex-pets/.well-known/oauth-protected-resource",
    ],
    [
      "/.well-known/oauth-protected-resource/codex-pets/mcp",
      "/codex-pets/.well-known/oauth-protected-resource/mcp",
    ],
  ])("rewrites RFC-derived OAuth metadata URL %s", async (source, target) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    const { middleware } = await import("@/middleware");
    const request = new NextRequest(`https://pets.example${source}`);

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://pets.example${target}`,
    );
  });

  it("adds agent Link headers to preview rewrites using the public pathname", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/", {
      headers: {
        "User-Agent": "TelegramBot",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://pets.example/api/preview/site",
    );
    expect(response.headers.get("Link")).toContain(
      '<http://localhost:3000/llms.txt>; rel="describedby"',
    );
  });

  it("preserves the configured base path for preview rewrites", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://pets.example/codex-pets/", {
      headers: {
        "User-Agent": "TelegramBot",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://pets.example/codex-pets/api/preview/site",
    );
  });
});
