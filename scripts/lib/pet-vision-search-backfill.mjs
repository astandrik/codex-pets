import { createHash } from "node:crypto";

import sharp from "sharp";

import { createRelatedPetsRebuildRequiredLog } from "./related-pets-maintenance.mjs";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const PET_VISION_FRAME_POLICY = {
  id: "pet-vision-central-frames-v1",
  frames: [
    { state: "idle", row: 0, frameCount: 6, frame: 3 },
    { state: "running-right", row: 1, frameCount: 8, frame: 4 },
    { state: "waving", row: 3, frameCount: 4, frame: 2 },
    { state: "review", row: 8, frameCount: 6, frame: 3 },
  ],
};

export const PET_VISION_SYSTEM_PROMPT =
  "You create internal search metadata for an animated software companion from four sprite frames. Describe only visible evidence. Do not infer or use identity, a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing or accessories, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.";

export const PET_VISION_USER_PROMPT =
  "The four images are ordered as idle, running-right, waving, and review. Produce the bilingual visual-search caption.";

export const PET_VISION_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "appearance",
    "clothing",
    "style",
    "mood",
    "colors",
    "search_terms_en",
    "search_terms_ru",
  ],
  properties: {
    subject: { $ref: "#/$defs/bilingualRequired" },
    appearance: { $ref: "#/$defs/bilingualRequired" },
    clothing: { $ref: "#/$defs/bilingualOptional" },
    style: { $ref: "#/$defs/bilingualRequired" },
    mood: { $ref: "#/$defs/bilingualRequired" },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { $ref: "#/$defs/termList" },
        ru: { $ref: "#/$defs/termList" },
      },
    },
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: {
    bilingualRequired: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", minLength: 1, maxLength: 320 },
        ru: { type: "string", minLength: 1, maxLength: 320 },
      },
    },
    bilingualOptional: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", maxLength: 240 },
        ru: { type: "string", maxLength: 240 },
      },
    },
    termList: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 40 },
    },
    searchTermList: {
      type: "array",
      minItems: 3,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
  },
};

const SHEETS = {
  1: { width: 1536, height: 1872, cellWidth: 192, cellHeight: 208 },
  2: { width: 1536, height: 2288, cellWidth: 192, cellHeight: 208 },
};
const CAPTION_FIELDS = [
  "subject",
  "appearance",
  "clothing",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
];
const SAFE_FAILURE_REASONS = new Set([
  "asset_error",
  "authentication_error",
  "content_filtered",
  "configuration_missing",
  "embedding_error",
  "invalid_request",
  "invalid_response",
  "malformed_json",
  "output_limit",
  "persistence_error",
  "provider_error",
  "rate_limited",
  "refused",
  "schema_invalid",
  "timeout",
]);

export class PetVisionBackfillError extends Error {
  constructor(reason) {
    super("Pet vision search backfill failed.");
    this.name = "PetVisionBackfillError";
    this.reason = reason;
  }
}

export function parseVisionBackfillArgs(argv) {
  let mode = null;
  let slug = null;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run" || argument === "--apply") {
      const nextMode = argument === "--dry-run" ? "dry-run" : "apply";
      if (mode && mode !== nextMode) {
        throw new Error("Pass exactly one of --dry-run or --apply.");
      }
      mode = nextMode;
      continue;
    }
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--slug" || argument?.startsWith("--slug=")) {
      const value = argument === "--slug"
        ? argv[index += 1]
        : argument.slice("--slug=".length);
      if (!value || !SAFE_SLUG.test(value)) {
        throw new Error("--slug must be a valid public pet slug.");
      }
      slug = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ""}`);
  }

  if (!mode) {
    throw new Error("Pass exactly one of --dry-run or --apply.");
  }
  if (force && mode !== "apply") {
    throw new Error("--force is valid only with --apply.");
  }
  return { mode, slug, force };
}

export async function extractPetVisionFrames(spritesheet) {
  if (!hasSupportedSpriteSignature(spritesheet)) {
    throw new Error("Unsupported sprite image format; expected PNG or WebP.");
  }

  const metadata = await sharp(spritesheet).metadata();
  const sheetEntry = Object.entries(SHEETS).find(
    ([, sheet]) =>
      sheet.width === metadata.width && sheet.height === metadata.height,
  );
  if (!sheetEntry) {
    throw new Error(
      `Unsupported sprite atlas dimensions: ${metadata.width ?? 0}x${metadata.height ?? 0}.`,
    );
  }
  const [spriteVersion, sheet] = sheetEntry;
  const frames = await Promise.all(
    PET_VISION_FRAME_POLICY.frames.map(async (selected) => {
      const png = await sharp(spritesheet)
        .extract({
          left: selected.frame * sheet.cellWidth,
          top: selected.row * sheet.cellHeight,
          width: sheet.cellWidth,
          height: sheet.cellHeight,
        })
        .png()
        .toBuffer();
      return {
        state: selected.state,
        row: selected.row,
        frame: selected.frame,
        png,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    }),
  );

  return {
    spriteVersion: Number(spriteVersion),
    spritesheetSha256: createHash("sha256")
      .update(spritesheet)
      .digest("hex"),
    frames,
  };
}

function hasSupportedSpriteSignature(buffer) {
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  return isPng || isWebp;
}

export function parsePetVisionCaption(input) {
  const value = strictObject(input, "caption", CAPTION_FIELDS);
  return {
    subject: bilingualText(value.subject, "subject", 320, true),
    appearance: bilingualText(
      value.appearance,
      "appearance",
      320,
      true,
    ),
    clothing: bilingualText(value.clothing, "clothing", 240, false),
    style: bilingualText(value.style, "style", 320, true),
    mood: bilingualText(value.mood, "mood", 320, true),
    colors: {
      en: stringList(
        strictObject(value.colors, "colors", ["en", "ru"]).en,
        "colors.en",
        1,
        8,
        40,
      ),
      ru: stringList(
        strictObject(value.colors, "colors", ["en", "ru"]).ru,
        "colors.ru",
        1,
        8,
        40,
      ),
    },
    search_terms_en: stringList(
      value.search_terms_en,
      "search_terms_en",
      3,
      20,
      60,
    ),
    search_terms_ru: stringList(
      value.search_terms_ru,
      "search_terms_ru",
      3,
      20,
      60,
    ),
  };
}

export function createPetVisionCaptionEnvelope(input) {
  return parseEnvelopeValue({
    schemaVersion: 1,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  return parseEnvelopeValue(parsed);
}

export function buildPetVisionCaptionText(caption) {
  return [
    `subject_en: ${caption.subject.en}`,
    `subject_ru: ${caption.subject.ru}`,
    `appearance_en: ${caption.appearance.en}`,
    `appearance_ru: ${caption.appearance.ru}`,
    `clothing_en: ${caption.clothing.en}`,
    `clothing_ru: ${caption.clothing.ru}`,
    `style_en: ${caption.style.en}`,
    `style_ru: ${caption.style.ru}`,
    `mood_en: ${caption.mood.en}`,
    `mood_ru: ${caption.mood.ru}`,
    `colors_en: ${caption.colors.en.join(", ")}`,
    `colors_ru: ${caption.colors.ru.join(", ")}`,
    `search_terms_en: ${caption.search_terms_en.join(", ")}`,
    `search_terms_ru: ${caption.search_terms_ru.join(", ")}`,
  ].join("\n");
}

export function createPetVisionCaptionSourceHash(input) {
  return lengthPrefixedSha256([
    input.captionRevision,
    input.modelUri,
    PET_VISION_SYSTEM_PROMPT,
    PET_VISION_USER_PROMPT,
    JSON.stringify(PET_VISION_RESPONSE_JSON_SCHEMA),
    PET_VISION_FRAME_POLICY.id,
    JSON.stringify(PET_VISION_FRAME_POLICY.frames),
    input.assetId,
    input.spritesheetSha256,
  ]);
}

export function createPetVisualEmbeddingSourceHash(input) {
  return lengthPrefixedSha256([
    input.visualRevision,
    input.captionRevision,
    input.captionSourceHash,
    input.captionText,
  ]);
}

export function embeddingToBuffer(embedding) {
  const buffer = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT + 1,
  );
  embedding.forEach((value, index) => {
    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  buffer[buffer.length - 1] = 0x01;
  return buffer;
}

export async function runPetVisionSearchBackfill(input) {
  const approvedPets = input.pets.filter(
    (candidate) => !candidate.status || candidate.status === "approved",
  );
  const selectedPets = input.options.slug
    ? approvedPets.filter(
        (candidate) => candidate.slug === input.options.slug,
      )
    : approvedPets;
  if (input.options.slug && selectedPets.length === 0) {
    throw new Error(`Approved pet slug not found: ${input.options.slug}`);
  }

  const summary = {
    scanned: selectedPets.length,
    unchanged: 0,
    vectorOnly: 0,
    captionAndVector: 0,
  };
  let hasCommittedSnapshotInput = false;

  try {
    for (const pet of selectedPets) {
      try {
        const action = await processPet(input, pet, () => {
          hasCommittedSnapshotInput = true;
        });
        if (action === "unchanged") summary.unchanged += 1;
        if (action === "vector-only") summary.vectorOnly += 1;
        if (action === "caption-and-vector") {
          summary.captionAndVector += 1;
        }
        input.log({ slug: pet.slug, action });
      } catch (error) {
        const failure = safeFailure(error);
        input.log({
          slug: pet.slug,
          action: "failed",
          reason: failure.reason,
        });
        throw failure;
      }
    }

    input.log({ action: "summary", ...summary });
    return summary;
  } finally {
    if (
      input.options.mode === "apply" &&
      hasCommittedSnapshotInput
    ) {
      input.log(createRelatedPetsRebuildRequiredLog());
    }
  }
}

async function processPet(input, pet, onSnapshotInputCommitted) {
  const assetId = petAssetId(pet.spritesheetUrl);
  if (!assetId) throw new PetVisionBackfillError("asset_error");

  let extracted;
  try {
    const spritesheet = await input.readSpritesheet(assetId);
    extracted = await input.extractFrames(spritesheet);
  } catch {
    throw new PetVisionBackfillError("asset_error");
  }

  const captionSourceHash = createPetVisionCaptionSourceHash({
    captionRevision: input.config.captionRevision,
    modelUri: input.config.modelUri,
    assetId,
    spritesheetSha256: extracted.spritesheetSha256,
  });
  let storedCaption = null;
  if (!input.options.force) {
    try {
      storedCaption = await input.getCaption(
        input.config.captionRevision,
        pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
  }
  const freshCaption = readFreshCaption({
    storedCaption,
    expectedSourceHash: captionSourceHash,
    assetId,
    spritesheetSha256: extracted.spritesheetSha256,
  });

  if (freshCaption) {
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: input.config.visualRevision,
      captionRevision: input.config.captionRevision,
      captionSourceHash,
      captionText: freshCaption.captionText,
    });
    let metadata;
    try {
      metadata = await input.getEmbeddingMetadata(
        input.config.visualRevision,
        pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    if (
      metadata?.sourceHash === visualSourceHash &&
      metadata.dimensions === input.config.dimensions
    ) {
      return "unchanged";
    }
    if (input.options.mode === "dry-run") return "vector-only";

    const embedding = await callProvider(
      () => input.embedDocument(freshCaption.captionText),
    );
    validateEmbedding(embedding, input.config.dimensions);
    try {
      await input.upsertEmbedding({
        modelRevision: input.config.visualRevision,
        slug: pet.slug,
        sourceHash: visualSourceHash,
        dimensions: input.config.dimensions,
        embedding,
        updatedAt: input.now().toISOString(),
      });
      onSnapshotInputCommitted();
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    return "vector-only";
  }

  if (input.options.mode === "dry-run") return "caption-and-vector";

  const caption = await callProvider(
    () => input.createCaption(extracted.frames),
  );
  const captionText = buildPetVisionCaptionText(caption);
  const captionJson = JSON.stringify(
    createPetVisionCaptionEnvelope({
      assetId,
      spritesheetSha256: extracted.spritesheetSha256,
      caption,
    }),
  );
  try {
    await input.upsertCaption({
      captionRevision: input.config.captionRevision,
      slug: pet.slug,
      sourceHash: captionSourceHash,
      captionJson,
      captionText,
      updatedAt: input.now().toISOString(),
    });
    onSnapshotInputCommitted();
  } catch {
    throw new PetVisionBackfillError("persistence_error");
  }

  const embedding = await callProvider(
    () => input.embedDocument(captionText),
  );
  validateEmbedding(embedding, input.config.dimensions);
  try {
    await input.upsertEmbedding({
      modelRevision: input.config.visualRevision,
      slug: pet.slug,
      sourceHash: createPetVisualEmbeddingSourceHash({
        visualRevision: input.config.visualRevision,
        captionRevision: input.config.captionRevision,
        captionSourceHash,
        captionText,
      }),
      dimensions: input.config.dimensions,
      embedding,
      updatedAt: input.now().toISOString(),
    });
    onSnapshotInputCommitted();
  } catch {
    throw new PetVisionBackfillError("persistence_error");
  }
  return "caption-and-vector";
}

async function callProvider(callback) {
  try {
    return await callback();
  } catch (error) {
    throw safeFailure(error);
  }
}

function safeFailure(error) {
  if (error instanceof PetVisionBackfillError) return error;
  const reason =
    error && typeof error === "object" && "reason" in error
      ? error.reason
      : null;
  return new PetVisionBackfillError(
    typeof reason === "string" && SAFE_FAILURE_REASONS.has(reason)
      ? reason
      : "provider_error",
  );
}

function readFreshCaption(input) {
  if (input.storedCaption?.sourceHash !== input.expectedSourceHash) {
    return null;
  }
  try {
    const envelope = parsePetVisionCaptionEnvelope(
      input.storedCaption.captionJson,
    );
    const captionText = buildPetVisionCaptionText(envelope.caption);
    if (
      envelope.source.assetId !== input.assetId ||
      envelope.source.spritesheetSha256 !== input.spritesheetSha256 ||
      captionText !== input.storedCaption.captionText
    ) {
      return null;
    }
    return { captionText };
  } catch {
    return null;
  }
}

function validateEmbedding(embedding, dimensions) {
  if (
    !Array.isArray(embedding) ||
    embedding.length !== dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new PetVisionBackfillError("embedding_error");
  }
}

function petAssetId(value) {
  let pathname = value;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function parseEnvelopeValue(input) {
  const envelope = strictObject(input, "caption envelope", [
    "schemaVersion",
    "source",
    "caption",
  ]);
  if (envelope.schemaVersion !== 1) {
    throw new Error("Caption envelope schemaVersion must be 1.");
  }
  const source = strictObject(envelope.source, "source", [
    "assetId",
    "spritesheetSha256",
  ]);
  const assetId = normalizedString(source.assetId, "source.assetId", 1, 256);
  const spritesheetSha256 = normalizedString(
    source.spritesheetSha256,
    "source.spritesheetSha256",
    64,
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(spritesheetSha256)) {
    throw new Error("source.spritesheetSha256 must be lowercase SHA-256.");
  }
  return {
    schemaVersion: 1,
    source: { assetId, spritesheetSha256 },
    caption: parsePetVisionCaption(envelope.caption),
  };
}

function bilingualText(input, path, maxLength, required) {
  const value = strictObject(input, path, ["en", "ru"]);
  return {
    en: normalizedString(value.en, `${path}.en`, required ? 1 : 0, maxLength),
    ru: normalizedString(value.ru, `${path}.ru`, required ? 1 : 0, maxLength),
  };
}

function stringList(input, path, minItems, maxItems, maxLength) {
  if (!Array.isArray(input)) {
    throw new Error(`${path} must be an array.`);
  }
  if (input.length > maxItems) {
    throw new Error(`${path} must contain at most ${maxItems} items.`);
  }
  const seen = new Set();
  const values = [];
  for (const [index, item] of input.entries()) {
    const normalized = normalizedString(
      item,
      `${path}[${index}]`,
      1,
      maxLength,
    );
    const key = normalized.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  if (values.length < minItems) {
    throw new Error(`${path} must contain at least ${minItems} unique items.`);
  }
  return values;
}

function normalizedString(input, path, minLength, maxLength) {
  if (typeof input !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const value = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (value.length < minLength || value.length > maxLength) {
    throw new Error(
      `${path} must contain between ${minLength} and ${maxLength} characters.`,
    );
  }
  return value;
}

function strictObject(input, path, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path} must be an object.`);
  }
  const allowed = new Set(fields);
  const unknownField = Object.keys(input).find((key) => !allowed.has(key));
  if (unknownField) {
    throw new Error(`${path} contains unknown field ${unknownField}.`);
  }
  const missingField = fields.find(
    (field) => !Object.prototype.hasOwnProperty.call(input, field),
  );
  if (missingField) {
    throw new Error(`${path} is missing field ${missingField}.`);
  }
  return input;
}

function lengthPrefixedSha256(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = typeof part === "string" ? Buffer.from(part, "utf8") : part;
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeUInt32BE(bytes.length);
    hash.update(prefix);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
