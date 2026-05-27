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
});
