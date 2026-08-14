import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeBasePath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function invalidConfig(reason) {
  return new Error(`Invalid public build configuration: ${reason}`);
}

function isLoopbackHostname(hostname) {
  const normalized = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  return (
    (ipVersion === 4 && normalized.startsWith("127.")) ||
    (ipVersion === 6 && normalized === "::1")
  );
}

export function validatePublicBuildConfig(environment) {
  const configuredAppUrl = environment.NEXT_PUBLIC_APP_URL?.trim();
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

  if (appUrl.username || appUrl.password) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain credentials.");
  }

  if (appUrl.search) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain a query.");
  }

  if (appUrl.hash) {
    throw invalidConfig("NEXT_PUBLIC_APP_URL must not contain a fragment.");
  }

  if (isLoopbackHostname(appUrl.hostname)) {
    throw invalidConfig(
      "NEXT_PUBLIC_APP_URL must not use localhost or a loopback address.",
    );
  }

  const basePath = normalizeBasePath(environment.NEXT_PUBLIC_BASE_PATH);
  if (normalizeBasePath(appUrl.pathname) !== basePath) {
    throw invalidConfig(
      "NEXT_PUBLIC_APP_URL pathname must match NEXT_PUBLIC_BASE_PATH.",
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
