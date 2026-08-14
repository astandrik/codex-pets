import { describe, expect, it } from "vitest";

const { validatePublicBuildConfig } = await import(
  "./validate-public-build-config.mjs"
);

describe("public build configuration", () => {
  it.each([
    {
      label: "direct origin",
      environment: {
        NEXT_PUBLIC_APP_URL: "https://pets.example",
        NEXT_PUBLIC_BASE_PATH: "",
      },
    },
    {
      label: "base path",
      environment: {
        NEXT_PUBLIC_APP_URL: "https://pets.example/codex-pets/",
        NEXT_PUBLIC_BASE_PATH: "/codex-pets/",
      },
    },
  ])("accepts a valid $label configuration", ({ environment }) => {
    expect(() => validatePublicBuildConfig(environment)).not.toThrow();
  });

  it.each([undefined, "", "   "])(
    "requires NEXT_PUBLIC_APP_URL",
    (appUrl) => {
      expect(() =>
        validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
      ).toThrow("NEXT_PUBLIC_APP_URL is required");
    },
  );

  it.each(["not a URL", "/relative", "ftp://pets.example"])(
    "rejects malformed or unsupported URL %s",
    (appUrl) => {
      expect(() =>
        validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
      ).toThrow("must be an absolute HTTP(S) URL");
    },
  );

  it.each([
    "http://localhost:3000",
    "https://catalog.localhost",
    "http://127.0.0.1:3000",
    "http://127.25.10.4",
    "http://[::1]:3000",
    "http://[0:0:0:0:0:0:0:1]",
  ])("rejects localhost or loopback URL %s", (appUrl) => {
    expect(() =>
      validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
    ).toThrow("must not use localhost or a loopback address");
  });

  it.each([
    {
      appUrl: "https://user:password@pets.example",
      message: "must not contain credentials",
    },
    {
      appUrl: "https://pets.example?token=secret",
      message: "must not contain a query",
    },
    {
      appUrl: "https://pets.example#secret",
      message: "must not contain a fragment",
    },
  ])("rejects URL metadata: $message", ({ appUrl, message }) => {
    expect(() =>
      validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
    ).toThrow(message);
  });

  it.each([
    {
      NEXT_PUBLIC_APP_URL: "https://pets.example/codex-pets",
      NEXT_PUBLIC_BASE_PATH: "",
    },
    {
      NEXT_PUBLIC_APP_URL: "https://pets.example",
      NEXT_PUBLIC_BASE_PATH: "/codex-pets",
    },
    {
      NEXT_PUBLIC_APP_URL: "https://pets.example/other",
      NEXT_PUBLIC_BASE_PATH: "/codex-pets",
    },
  ])("rejects an origin/base-path mismatch", (environment) => {
    expect(() => validatePublicBuildConfig(environment)).toThrow(
      "pathname must match NEXT_PUBLIC_BASE_PATH",
    );
  });

  it("does not expose rejected configuration values in errors", () => {
    const appUrl = "https://user:super-secret@pets.example";

    let message = "";
    try {
      validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(appUrl);
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("user");
  });
});
