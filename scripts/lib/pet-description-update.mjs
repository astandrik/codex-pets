import { readFileSync } from "node:fs";

// Hard ingestion bound, keep in sync with src/lib/pets/validation.ts.
export const MAX_DESCRIPTION_LENGTH = 320;

export function parseUpdateArgs(argv) {
  let file = null;
  let apply = false;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}.`);
    } else if (file === null) {
      file = arg;
    } else {
      throw new Error("Exactly one JSON file argument is allowed.");
    }
  }

  if (apply && dryRun) {
    throw new Error("Exactly one of --dry-run or --apply may be passed.");
  }
  if (!file) {
    throw new Error(
      "Usage: node scripts/update-pet-descriptions.mjs <updates.json> [--dry-run|--apply]",
    );
  }

  return { file, apply };
}

export function readDescriptionUpdates(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read updates JSON at ${filePath}: ${errorMessage(error)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Updates file ${filePath} is not valid JSON: ${errorMessage(error)}`,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `Updates file ${filePath} must contain a JSON object mapping slug to description.`,
    );
  }

  const problems = [];
  for (const [slug, description] of Object.entries(payload)) {
    const problem = validateDescription(description);
    if (problem) {
      problems.push(`${slug}: ${problem}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing the whole batch; ${problems.length} invalid description(s):\n- ${problems.join("\n- ")}`,
    );
  }

  return Object.entries(payload)
    .map(([slug, description]) => ({ slug, description }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export function assertAllSlugsFound(updates, currentDescriptions) {
  const missing = updates
    .map((update) => update.slug)
    .filter((slug) => !currentDescriptions.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `Refusing the whole batch; unknown slug(s) in the pets table: ${missing.join(", ")}.`,
    );
  }
}

function validateDescription(description) {
  if (typeof description !== "string") {
    return "description must be a string.";
  }
  if (description.trim().length === 0) {
    return "description must be non-empty.";
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `description is ${description.length} chars; the hard limit is ${MAX_DESCRIPTION_LENGTH}.`;
  }
  return null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
