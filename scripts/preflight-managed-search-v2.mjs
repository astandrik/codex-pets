#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runManagedSearchPreflight } from "./lib/pet-search-preflight.mjs";

export async function main() {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  const apiKeyFile =
    process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
  if (!folderId || !apiKeyFile) {
    throw new Error(
      "YANDEX_AI_STUDIO_FOLDER_ID and YANDEX_AI_STUDIO_API_KEY_FILE are required.",
    );
  }
  const apiKey = readFileSync(apiKeyFile, "utf8").trim();
  if (!apiKey) {
    throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  }

  const result = await runManagedSearchPreflight({
    folderId,
    apiKey,
  });
  const scratchDirectory = resolve(process.cwd(), ".scratch");
  await mkdir(scratchDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(scratchDirectory, "pet-search-v2-preflight.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  return result;
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      error?.reason
        ? [
            `Managed search preflight failed: ${error.reason}`,
            error.role ? `role=${error.role}` : null,
            Number.isInteger(error.httpStatus)
              ? `httpStatus=${error.httpStatus}`
              : null,
          ].filter(Boolean).join(" ") + "."
        : error instanceof Error
          ? error.message
          : "Managed search preflight failed.",
    );
    process.exitCode = 1;
  });
}
