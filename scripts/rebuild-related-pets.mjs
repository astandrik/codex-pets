#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
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
    return 0;
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
}

async function loadProductionService() {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!specifier.startsWith("@/")) {
        return nextResolve(specifier, context);
      }
      const sourcePath = path.join(sourceRoot, `${specifier.slice(2)}.ts`);
      if (!existsSync(sourcePath)) {
        throw new Error("Related pets runtime module is unavailable.");
      }
      return { url: pathToFileURL(sourcePath).href, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (!url.endsWith(".ts")) return nextLoad(url, context);
      const source = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        source: stripTypeScriptTypes(source, {
          mode: "transform",
          sourceMap: true,
          sourceUrl: url,
        }),
        shortCircuit: true,
      };
    },
  });

  try {
    const runtime = await import(
      pathToFileURL(
        path.join(sourceRoot, "lib/pets/related-pets-rebuild.ts"),
      ).href
    );
    return {
      rebuild: runtime.rebuildRelatedPets,
      recoverPrevious: runtime.recoverPreviousRelatedPets,
    };
  } finally {
    hooks.deregister();
  }
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
    .catch(() => {
      console.error(
        JSON.stringify({
          operation: "related-pets-rebuild",
          status: "failed",
          failureReason: "rebuild_failed",
        }),
      );
      process.exitCode = 1;
    });
}
