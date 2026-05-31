const MARKDOWN_TWIN_PATHS = new Map<string, string>([
  ["/", "/index.md"],
  ["/about", "/about.md"],
  ["/agents", "/agents.md"],
  ["/pricing", "/pricing.md"],
  ["/terms", "/terms.md"],
  ["/developers", "/developers.md"],
  ["/docs/api", "/docs/api.md"],
]);

export function getMarkdownTwinPath(pathname: string): string | null {
  return MARKDOWN_TWIN_PATHS.get(normalizePathname(pathname)) ?? null;
}

export function isMarkdownTwinSourcePath(pathname: string): boolean {
  return MARKDOWN_TWIN_PATHS.has(normalizePathname(pathname));
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
