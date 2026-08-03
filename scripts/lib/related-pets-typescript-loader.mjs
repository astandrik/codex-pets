import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

let sourceRoot = null;

export function initialize({ sourceRootUrl }) {
  sourceRoot = realpathSync(fileURLToPath(sourceRootUrl));
}

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const candidate = containedSourcePath(`${specifier.slice(2)}.ts`);
  if (!existsSync(candidate)) {
    throw new Error("Related pets runtime module is unavailable.");
  }
  return { url: pathToFileURL(candidate).href, shortCircuit: true };
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);

  const sourcePath = containedSourcePath(fileURLToPath(url));
  const source = readFileSync(sourcePath, "utf8");
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      inlineSourceMap: true,
      inlineSources: true,
    },
    fileName: sourcePath,
  });
  return {
    format: "module",
    source: transformed.outputText,
    shortCircuit: true,
  };
}

function containedSourcePath(value) {
  if (!sourceRoot) {
    throw new Error("Related pets loader source root is unavailable.");
  }
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(sourceRoot, value);
  const relative = path.relative(sourceRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Related pets runtime module is outside the source root.");
  }
  return candidate;
}
