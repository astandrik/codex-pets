#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repositoryRoot, "src");

export const RELATED_PETS_REBUILD_HELP = `Usage:
  npm run related:rebuild -- --dry-run
  npm run related:rebuild -- --apply
  npm run related:rebuild -- --recover-previous
  npm run related:rebuild -- --help

Modes:
  --dry-run           Validate stored vectors and compute rankings without writes.
  --apply             Build and conditionally publish a new full generation.
  --recover-previous  Atomically republish the retained previous generation.
  --help              Show this help.`;

export function parseRelatedPetsRebuildArgs(argv) {
  const supported = new Set([
    "--dry-run",
    "--apply",
    "--recover-previous",
    "--help",
  ]);
  const unknown = argv.find((argument) => !supported.has(argument));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }
  if (argv.length !== 1 || new Set(argv).size !== 1) {
    throw new Error(
      "Select exactly one of --dry-run, --apply, --recover-previous, or --help.",
    );
  }

  const [argument] = argv;
  if (argument === "--dry-run") return { mode: "dry-run" };
  if (argument === "--apply") return { mode: "apply" };
  if (argument === "--recover-previous") {
    return { mode: "recover-previous" };
  }
  if (argument === "--help") return { mode: "help" };
  throw new Error(
    "Select exactly one of --dry-run, --apply, --recover-previous, or --help.",
  );
}

export async function runRelatedPetsRebuildCli({
  argv = process.argv.slice(2),
  loadService = loadProductionService,
  write = (line) => console.log(line),
} = {}) {
  const options = parseRelatedPetsRebuildArgs(argv);
  if (options.mode === "help") {
    write(RELATED_PETS_REBUILD_HELP);
    return 0;
  }

  const service = await loadService();
  try {
    if (options.mode === "recover-previous") {
      const result = await service.recoverPrevious();
      write(
        JSON.stringify({
          operation: "recover-previous",
          status: result.status,
          generationId: result.generationId,
          rankingRevision: result.rankingRevision,
          durationMs: result.durationMs,
        }),
      );
      return result.status === "recovered" ? 0 : 1;
    }

    const result = await service.rebuild({
      mode: options.mode,
      includeVisual: true,
    });
    write(
      JSON.stringify({
        operation: result.operation,
        status: result.status,
        generationId: result.generationId,
        rankingRevision: result.rankingRevision,
        coverage: result.coverage,
        durationMs: result.durationMs,
      }),
    );
    return 0;
  } finally {
    await service.dispose?.();
  }
}

async function loadProductionService() {
  const { register } = await import("node:module");
  register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
    parentURL: import.meta.url,
    data: { sourceRootUrl: pathToFileURL(sourceRoot).href },
  });

  const runtime = await import(
    pathToFileURL(
      path.join(sourceRoot, "lib/pets/related-pets-rebuild.ts"),
    ).href
  );
  const { destroyYdbDriver } = await import(
    pathToFileURL(path.join(sourceRoot, "lib/ydb/client.ts")).href
  );
  return {
    rebuild: runtime.rebuildRelatedPets,
    recoverPrevious: runtime.recoverPreviousRelatedPets,
    dispose: destroyYdbDriver,
  };
}

function isEntrypoint() {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  runRelatedPetsRebuildCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const failureReason =
        error instanceof Error && error.message === "storage_unavailable"
          ? "storage_unavailable"
          : "rebuild_failed";
      console.error(
        JSON.stringify({
          operation: "related-pets-rebuild",
          status: "failed",
          failureReason,
        }),
      );
      process.exitCode = 1;
    });
}
