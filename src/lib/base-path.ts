function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") {
    return "";
  }

  const normalized = `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "" : normalized;
}

export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function withBasePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`withBasePath expects an absolute path, got: ${path}`);
  }

  if (!BASE_PATH) {
    return path;
  }

  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    return path;
  }

  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}

export function getPublicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) {
    return "http://localhost:3000";
  }

  const url = new URL(configured);
  return url.origin;
}

export function toPublicUrl(path: string): string {
  return `${getPublicOrigin()}${withBasePath(path)}`;
}
