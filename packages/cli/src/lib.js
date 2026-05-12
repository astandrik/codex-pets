import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://pets.ydb-qdrant.tech";

const SPRITESHEET_RE = /^spritesheet\.(webp|png)$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    command: null,
    slug: null,
    force: false,
    baseUrl: null,
    help: false,
    version: false,
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--version") {
      parsed.version = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--url") {
      const value = args.shift();
      if (!value) throw new Error("--url requires a value.");
      parsed.baseUrl = value;
      continue;
    }
    if (arg?.startsWith("--url=")) {
      parsed.baseUrl = arg.slice("--url=".length);
      continue;
    }
    if (arg?.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!parsed.command) {
      parsed.command = arg;
      continue;
    }
    if (!parsed.slug) {
      parsed.slug = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!parsed.command && !parsed.help && !parsed.version) {
    parsed.help = true;
  }

  return parsed;
}

export function normalizeBaseUrl(value) {
  const base = (value || DEFAULT_BASE_URL).trim();
  if (!base) throw new Error("Base URL cannot be empty.");

  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildApiUrl(baseUrl, pathname) {
  if (!pathname.startsWith("/")) {
    throw new Error(`API path must start with /, got: ${pathname}`);
  }

  const url = new URL(normalizeBaseUrl(baseUrl));
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${pathname}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function toAbsoluteUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Manifest asset URL is missing.");
  }

  try {
    return new URL(value).toString();
  } catch {
    const normalizedBase = `${normalizeBaseUrl(baseUrl)}/`;
    return new URL(value, normalizedBase).toString();
  }
}

export function resolveCodexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

export async function fetchManifest(baseUrl, fetchImpl = globalThis.fetch) {
  const url = buildApiUrl(baseUrl, "/api/manifest");
  const response = await fetchOk(fetchImpl, url, "manifest");
  const manifest = await response.json();
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.pets)) {
    throw new Error("Manifest response must contain a pets array.");
  }
  return manifest;
}

export function findManifestPet(manifest, slug) {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid pet slug: ${slug}`);
  }

  const pet = manifest.pets.find((item) => item?.slug === slug);
  if (!pet) {
    throw new Error(`Pet not found in gallery: ${slug}`);
  }
  return normalizeManifestPet(pet);
}

export async function listPets(options = {}) {
  const baseUrl = resolveBaseUrl(options);
  const manifest = await fetchManifest(baseUrl, options.fetchImpl);
  return manifest.pets.map(normalizeManifestPet);
}

export async function installPet(options) {
  const baseUrl = resolveBaseUrl(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const slug = options.slug;
  const codexHome = path.resolve(options.codexHome ?? resolveCodexHome());
  const petsDir = path.join(codexHome, "pets");
  const targetDir = path.join(petsDir, slug);

  const manifest = await fetchManifest(baseUrl, fetchImpl);
  const pet = findManifestPet(manifest, slug);

  if ((await pathExists(targetDir)) && !options.force) {
    throw new Error(
      `Pet already exists at ${targetDir}. Re-run with --force to replace it.`,
    );
  }

  const spriteFilename = spritesheetFilenameFromUrl(pet.spritesheetUrl);
  const [petJsonBuffer, spritesheetBuffer] = await Promise.all([
    fetchBuffer(fetchImpl, toAbsoluteUrl(pet.petJsonUrl, baseUrl), "pet.json"),
    fetchBuffer(fetchImpl, toAbsoluteUrl(pet.spritesheetUrl, baseUrl), spriteFilename),
  ]);

  validatePetJsonBuffer(petJsonBuffer, spriteFilename);

  await fs.mkdir(petsDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(petsDir, `.tmp-${slug}-`));
  let installed = false;

  try {
    await fs.writeFile(path.join(tempDir, "pet.json"), petJsonBuffer);
    await fs.writeFile(path.join(tempDir, spriteFilename), spritesheetBuffer);

    if (options.force) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await fs.rename(tempDir, targetDir);
    installed = true;
  } finally {
    if (!installed) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  const metricRecorded = await postInstallMetric({
    baseUrl,
    slug,
    fetchImpl,
    warn: options.warn,
  });

  return {
    pet,
    targetDir,
    metricRecorded,
  };
}

export async function postInstallMetric(options) {
  try {
    const response = await options.fetchImpl(
      buildApiUrl(options.baseUrl, `/api/pets/${encodeURIComponent(options.slug)}/install`),
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    options.warn?.(
      `Installed locally, but install metrics were not recorded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export async function runCli(argv, io = {}) {
  const parsed = parseArgs(argv);
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const env = io.env ?? process.env;
  const baseUrl = parsed.baseUrl ?? env.CODEX_PETS_URL ?? DEFAULT_BASE_URL;

  if (parsed.version) {
    stdout("0.1.1");
    return;
  }

  if (parsed.help) {
    stdout(helpText());
    return;
  }

  if (parsed.command === "list") {
    const pets = await listPets({
      baseUrl,
      fetchImpl: io.fetchImpl,
    });
    for (const pet of pets) {
      stdout(`${pet.slug}\t${pet.displayName}`);
    }
    return;
  }

  if (parsed.command === "install") {
    if (!parsed.slug) {
      throw new Error("Usage: codex-pets install <slug> [--force] [--url <baseUrl>]");
    }

    const result = await installPet({
      slug: parsed.slug,
      force: parsed.force,
      baseUrl,
      fetchImpl: io.fetchImpl,
      codexHome: resolveCodexHome(env),
      warn: stderr,
    });
    stdout(`Installed ${result.pet.slug} to ${result.targetDir}`);
    stdout(
      "If Codex is already running, restart it before selecting the pet in Settings -> Appearance -> Pets.",
    );
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}`);
}

function helpText() {
  return `codex-pets

Usage:
  codex-pets list [--url <baseUrl>]
  codex-pets install <slug> [--force] [--url <baseUrl>]
  codex-pets --help
  codex-pets --version

Environment:
  CODEX_PETS_URL  Gallery URL. Defaults to ${DEFAULT_BASE_URL}
  CODEX_HOME      Codex home. Defaults to ~/.codex`;
}

function resolveBaseUrl(options = {}) {
  return normalizeBaseUrl(options.baseUrl ?? process.env.CODEX_PETS_URL ?? DEFAULT_BASE_URL);
}

function normalizeManifestPet(pet) {
  const fields = ["slug", "displayName", "spritesheetUrl", "petJsonUrl"];
  for (const field of fields) {
    if (typeof pet[field] !== "string" || !pet[field].trim()) {
      throw new Error(`Manifest pet is missing ${field}.`);
    }
  }
  spritesheetFilenameFromUrl(pet.spritesheetUrl);
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    spritesheetUrl: pet.spritesheetUrl,
    petJsonUrl: pet.petJsonUrl,
  };
}

function spritesheetFilenameFromUrl(value) {
  const pathname = new URL(toAbsoluteUrl(value, DEFAULT_BASE_URL)).pathname;
  const filename = pathname.split("/").pop() ?? "";
  if (!SPRITESHEET_RE.test(filename)) {
    throw new Error("Manifest spritesheetUrl must end with spritesheet.webp or spritesheet.png.");
  }
  return filename;
}

async function fetchBuffer(fetchImpl, url, label) {
  const response = await fetchOk(fetchImpl, url, label);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchOk(fetchImpl, url, label) {
  if (!fetchImpl) {
    throw new Error("This CLI requires a runtime with fetch support.");
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  return response;
}

function validatePetJsonBuffer(buffer, spriteFilename) {
  let petJson;
  try {
    petJson = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Downloaded pet.json is not valid JSON.");
  }

  if (!petJson || typeof petJson !== "object" || Array.isArray(petJson)) {
    throw new Error("Downloaded pet.json must be a JSON object.");
  }

  if (petJson.spritesheetPath !== spriteFilename) {
    throw new Error(
      `pet.json spritesheetPath must be ${spriteFilename}; got ${String(
        petJson.spritesheetPath,
      )}.`,
    );
  }
}

async function pathExists(value) {
  try {
    await fs.access(value, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
