import { getPublicOrigin } from "@/lib/base-path";

export function isAllowedMcpOrigin(originHeader: string | null): boolean {
  if (!originHeader) return true;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  if (origin.origin === getPublicOrigin()) {
    return true;
  }

  return process.env.NODE_ENV !== "production" && isLocalhost(origin.hostname);
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}
