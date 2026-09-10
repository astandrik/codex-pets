import { describe, expect, it, vi } from "vitest";

const { validatePublicBuildConfig } = await import(
  "./validate-public-build-config.mjs"
);
type PublicBuildEnvironment = Parameters<typeof validatePublicBuildConfig>[0];

function expectInvalidAppUrl(appUrl: string | undefined, message: string) {
  expect(() =>
    validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
  ).toThrow(message);
}

function getValidationError(environment: PublicBuildEnvironment) {
  try {
    validatePublicBuildConfig(environment);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected public build configuration validation to fail.");
}

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
      expectInvalidAppUrl(appUrl, "NEXT_PUBLIC_APP_URL is required");
    },
  );

  it.each(["not a URL", "/relative", "ftp://pets.example"])(
    "rejects malformed or unsupported URL %s",
    (appUrl) => {
      expectInvalidAppUrl(appUrl, "must be an absolute HTTP(S) URL");
    },
  );

  it.each(["http://.", "http://%2e"])(
    "rejects an empty normalized hostname in %s",
    (appUrl) => {
      expectInvalidAppUrl(appUrl, "must contain a nonempty hostname");
    },
  );

  it.each(["http://pets.example:0", "https://pets.example:0"])(
    "rejects explicit port zero in URL %s",
    (appUrl) => {
      expectInvalidAppUrl(appUrl, "must not use port zero");
    },
  );

  it.each([
    "http://localhost:3000",
    "https://catalog.localhost",
    "http://127.0.0.1:3000",
    "http://127.25.10.4",
    "http://[::1]:3000",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:7f00:1]",
  ])("rejects localhost or loopback URL %s", (appUrl) => {
    expectInvalidAppUrl(
      appUrl,
      "must not use localhost or a loopback address",
    );
  });

  it.each([
    "http://0.0.0.0",
    "http://[::]",
    "http://[0:0:0:0:0:0:0:0]",
    "http://[::ffff:0.0.0.0]",
  ])("rejects unspecified URL %s", (appUrl) => {
    expectInvalidAppUrl(appUrl, "must not use an unspecified address");
  });

  it.each([
    "http://224.0.0.0",
    "http://224.0.0.1",
    "http://239.255.255.255",
    "http://255.255.255.255",
    "http://[ff00::]",
    "http://[ff02::1]",
    "http://[ffff::1]",
    "http://[::ffff:224.0.0.1]",
    "http://[::ffff:255.255.255.255]",
  ])("rejects multicast or broadcast URL %s", (appUrl) => {
    expectInvalidAppUrl(
      appUrl,
      "must not use a multicast or broadcast address",
    );
  });

  it.each(["http://223.255.255.255", "http://[feff::1]"])(
    "accepts address outside the multicast ranges: %s",
    (appUrl) => {
      expect(() =>
        validatePublicBuildConfig({ NEXT_PUBLIC_APP_URL: appUrl }),
      ).not.toThrow();
    },
  );

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
    expectInvalidAppUrl(appUrl, message);
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

  it.each(["/foo//bar", "/foo///bar", "//foo//bar//"])(
    "rejects internal repeated slashes in a matching base path: %s",
    (basePath) => {
      const environment = {
        NEXT_PUBLIC_APP_URL: `https://pets.example${basePath}`,
        NEXT_PUBLIC_BASE_PATH: basePath,
      };
      expect(() => validatePublicBuildConfig(environment)).toThrow(
        "NEXT_PUBLIC_BASE_PATH must not contain repeated slashes",
      );
      expect(getValidationError(environment)).not.toContain(basePath);
    },
  );

  it.each(["/foo/bar", "//"])("preserves valid base-path normalization: %s", (basePath) => {
    expect(() => validatePublicBuildConfig({
      NEXT_PUBLIC_APP_URL: `https://pets.example${basePath}`,
      NEXT_PUBLIC_BASE_PATH: basePath,
    })).not.toThrow();
  });

  it("does not expose rejected configuration values in errors", () => {
    const appUrl = "https://user:super-secret@pets.example";
    const message = getValidationError({ NEXT_PUBLIC_APP_URL: appUrl });

    expect(message).not.toContain(appUrl);
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("user");
  });

  it("accepts normalized runtime configuration matching the Docker build", () => {
    expect(() =>
      validatePublicBuildConfig({
        NEXT_PUBLIC_APP_URL: "https://pets.example/codex-pets",
        NEXT_PUBLIC_BASE_PATH: "/codex-pets",
        CODEX_PETS_BUILT_PUBLIC_APP_URL:
          "https://pets.example/codex-pets/",
        CODEX_PETS_BUILT_PUBLIC_BASE_PATH: "/codex-pets/",
      }),
    ).not.toThrow();
  });

  it("normalizes slash-only Docker metadata to an empty base path", () => {
    expect(() =>
      validatePublicBuildConfig({
        NEXT_PUBLIC_APP_URL: "https://pets.example",
        NEXT_PUBLIC_BASE_PATH: "",
        CODEX_PETS_BUILT_PUBLIC_APP_URL: "https://pets.example//",
        CODEX_PETS_BUILT_PUBLIC_BASE_PATH: "//",
      }),
    ).not.toThrow();
  });

  it("does not pass a slash-only base path to Next.js", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "//");

    const { default: nextConfig } = await import("../next.config");
    expect(nextConfig.basePath).toBeUndefined();

    vi.unstubAllEnvs();
  });

  it.each([
    {
      NEXT_PUBLIC_APP_URL: "https://runtime.example/codex-pets",
      NEXT_PUBLIC_BASE_PATH: "/codex-pets",
      CODEX_PETS_BUILT_PUBLIC_APP_URL:
        "https://pets.example/codex-pets",
      CODEX_PETS_BUILT_PUBLIC_BASE_PATH: "/codex-pets",
    },
    {
      NEXT_PUBLIC_APP_URL: "https://pets.example/other",
      NEXT_PUBLIC_BASE_PATH: "/other",
      CODEX_PETS_BUILT_PUBLIC_APP_URL:
        "https://pets.example/codex-pets",
      CODEX_PETS_BUILT_PUBLIC_BASE_PATH: "/codex-pets",
    },
  ])("rejects runtime configuration that differs from the Docker build", (environment) => {
    expect(() => validatePublicBuildConfig(environment)).toThrow(
      "must match the Docker image build configuration",
    );
  });

  it("rejects incomplete Docker build configuration metadata", () => {
    expect(() =>
      validatePublicBuildConfig({
        NEXT_PUBLIC_APP_URL: "https://pets.example",
        NEXT_PUBLIC_BASE_PATH: "",
        CODEX_PETS_BUILT_PUBLIC_APP_URL: "https://pets.example",
      }),
    ).toThrow("Docker image public build configuration is incomplete");
  });

  it("does not expose runtime or build configuration values on mismatch", () => {
    const runtimeAppUrl = "https://runtime-secret.example";
    const builtAppUrl = "https://build-secret.example";
    const message = getValidationError({
      NEXT_PUBLIC_APP_URL: runtimeAppUrl,
      NEXT_PUBLIC_BASE_PATH: "",
      CODEX_PETS_BUILT_PUBLIC_APP_URL: builtAppUrl,
      CODEX_PETS_BUILT_PUBLIC_BASE_PATH: "",
    });

    expect(message).not.toContain(runtimeAppUrl);
    expect(message).not.toContain(builtAppUrl);
    expect(message).not.toContain("secret");
  });
});
