import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeBasePath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const pathname = trimmed.replace(/^\/+|\/+$/g, "");
  return pathname ? `/${pathname}` : "";
}

function invalidConfig(reason) {
  return new Error(`Invalid public build configuration: ${reason}`);
}

function normalizeHostname(hostname) {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function getMappedIpv4Bytes(hostname) {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
  if (!match) {
    return undefined;
  }

  const highWord = Number.parseInt(match[1], 16);
  const lowWord = Number.parseInt(match[2], 16);
  return [
    highWord >> 8,
    highWord & 0xff,
    lowWord >> 8,
    lowWord & 0xff,
  ];
}

function getIpv4Bytes(hostname) {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return hostname.split(".").map(Number);
  }

  return ipVersion === 6 ? getMappedIpv4Bytes(hostname) : undefined;
}

function getForbiddenHostnameReason(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "NEXT_PUBLIC_APP_URL must not use localhost or a loopback address.";
  }

  const ipv4 = getIpv4Bytes(hostname);
  if (ipv4?.[0] === 127 || hostname === "::1") {
    return "NEXT_PUBLIC_APP_URL must not use localhost or a loopback address.";
  }

  if (hostname === "::" || ipv4?.every((byte) => byte === 0)) {
    return "NEXT_PUBLIC_APP_URL must not use an unspecified address.";
  }

  if (
    (ipv4 &&
      ((ipv4[0] >= 224 && ipv4[0] <= 239) ||
        ipv4.every((byte) => byte === 255))) ||
    (isIP(hostname) === 6 && hostname.startsWith("ff"))
  ) {
    return "NEXT_PUBLIC_APP_URL must not use a multicast or broadcast address.";
  }
}

function parsePublicBuildConfig(configuredAppUrlValue, configuredBasePath) {
  const configuredAppUrl = configuredAppUrlValue?.trim();
  if (!configuredAppUrl) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL is required.");
  }

  let appUrl;
  try {
    appUrl = new URL(configuredAppUrl);
  } catch {
    throw invalidConfig(
      "NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) URL.",
    );
  }

  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw invalidConfig(
      "NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) URL.",
    );
  }

  if (appUrl.port === "0") {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not use port zero.");
  }

  if (appUrl.username || appUrl.password) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain credentials.");
  }

  if (appUrl.search) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain a query.");
  }

  if (appUrl.hash) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain a fragment.");
  }

  const hostname = normalizeHostname(appUrl.hostname);
  if (!hostname) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must contain a nonempty hostname.");
  }
  const forbiddenHostnameReason = getForbiddenHostnameReason(hostname);
  if (forbiddenHostnameReason) {
    throw invalidConfig(forbiddenHostnameReason);
  }

  const basePath = normalizeBasePath(configuredBasePath);
  if (normalizeBasePath(appUrl.pathname) !== basePath) {
    throw invalidConfig(
      "NEXT_PUBLIC_APP_URL pathname must match NEXT_PUBLIC_BASE_PATH.",
    );
  }

  return {
    appUrl: `${appUrl.origin}${basePath}`,
    basePath,
  };
}

export function validatePublicBuildConfig(environment) {
  const runtimeConfig = parsePublicBuildConfig(
    environment.NEXT_PUBLIC_APP_URL,
    environment.NEXT_PUBLIC_BASE_PATH,
  );
  const builtAppUrl = environment.CODEX_PETS_BUILT_PUBLIC_APP_URL;
  const builtBasePath = environment.CODEX_PETS_BUILT_PUBLIC_BASE_PATH;
  const hasBuiltAppUrl = builtAppUrl !== undefined;
  const hasBuiltBasePath = builtBasePath !== undefined;

  if (hasBuiltAppUrl !== hasBuiltBasePath) {
    throw invalidConfig(
      "Docker image public build configuration is incomplete.",
    );
  }

  if (!hasBuiltAppUrl) {
    return;
  }

  const builtConfig = parsePublicBuildConfig(builtAppUrl, builtBasePath);
  if (
    runtimeConfig.appUrl !== builtConfig.appUrl ||
    runtimeConfig.basePath !== builtConfig.basePath
  ) {
    throw invalidConfig(
      "Runtime public configuration must match the Docker image build configuration.",
    );
  }
}

const isDirectExecution =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    validatePublicBuildConfig(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation failed.";
    console.error(message);
    process.exitCode = 1;
  }
}
