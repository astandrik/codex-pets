const INTERNAL_SEARCH_DIAGNOSTIC_KEYS = new Set([
  "mode",
  "fallbackreason",
  "durationms",
  "visualmode",
  "visualfallbackreason",
  "visualcandidatecount",
]);

export function findInternalSearchFieldPaths(value: unknown): string[] {
  const paths: string[] = [];
  const visited = new WeakSet<object>();
  visit(value, "", paths, visited);
  return paths;
}

function visit(
  value: unknown,
  path: string,
  paths: string[],
  visited: WeakSet<object>,
): void {
  if (!value || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visit(item, `${path}[${index}]`, paths, visited),
    );
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (isInternalSearchField(key)) paths.push(nestedPath);
    visit(nested, nestedPath, paths, visited);
  }
}

function isInternalSearchField(key: string): boolean {
  const normalized = key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    INTERNAL_SEARCH_DIAGNOSTIC_KEYS.has(normalized) ||
    normalized.includes("caption") ||
    normalized.startsWith("accessor") ||
    normalized.includes("hash") ||
    normalized.includes("provenance") ||
    normalized.includes("score") ||
    normalized === "prompt" ||
    normalized === "prompts" ||
    normalized === "systemprompt" ||
    normalized === "providerprompt" ||
    normalized === "visionprompt" ||
    normalized === "captionprompt" ||
    normalized === "searchprompt"
  );
}
