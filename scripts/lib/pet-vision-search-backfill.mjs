import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  PET_VISION_CAPTION_REVISION_V1,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISION_PIPELINES,
  requirePetVisionPipeline,
} from "../../src/lib/pets/search-vision-pipelines.mjs";
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
const CAPTION_FIELDS_V2 = [
  "subject",
  "appearance",
  "clothing",
  "style",
  "mood",
  "colors",
  "accessories",
  "distinctive_features",
  "pose_motion",
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
  let continueOnError = false;

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
    if (argument === "--continue-on-error") {
      continueOnError = true;
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
  if (continueOnError && (mode !== "apply" || slug)) {
    throw new Error(
      "--continue-on-error is valid only for a full --apply run.",
    );
  }
  return { mode, slug, force, continueOnError };
}

export async function extractPetVisionFrames(
  spritesheet,
  framePolicy = PET_VISION_FRAME_POLICY,
) {
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
    framePolicy.frames.map(async (selected) => {
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
  return parseCaptionValue(input, false);
}

export function parsePetVisionCaptionForRevision(input, captionRevision) {
  const pipeline = requirePetVisionPipeline(captionRevision);
  return parseCaptionValue(input, pipeline.schemaVersion === 2);
}

function parseCaptionValue(input, includeV2Fields) {
  const value = strictObject(
    input,
    "caption",
    includeV2Fields ? CAPTION_FIELDS_V2 : CAPTION_FIELDS,
  );
  const shared = {
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
  if (!includeV2Fields) return shared;
  return {
    ...shared,
    accessories: bilingualText(
      value.accessories,
      "accessories",
      240,
      false,
    ),
    distinctive_features: bilingualText(
      value.distinctive_features,
      "distinctive_features",
      240,
      false,
    ),
    pose_motion: bilingualText(
      value.pose_motion,
      "pose_motion",
      240,
      false,
    ),
  };
}

export function createPetVisionCaptionEnvelope(input) {
  const captionRevision =
    input.captionRevision ?? PET_VISION_CAPTION_REVISION_V1;
  const pipeline = requirePetVisionPipeline(captionRevision);
  if (pipeline.schemaVersion === 2) {
    return parseEnvelopeValue({
      schemaVersion: 2,
      source: {
        assetId: input.assetId,
        spritesheetSha256: input.spritesheetSha256,
      },
      provenance: {
        origin: "provider",
        api: "responses",
        model: pipeline.modelName,
        framePolicy: pipeline.framePolicy.id,
      },
      caption: input.caption,
    });
  }
  return parseEnvelopeValue({
    schemaVersion: 1,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(value, expectedCaptionRevision) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  const envelope = parseEnvelopeValue(parsed);
  const expectedPipeline = expectedCaptionRevision
    ? PET_VISION_PIPELINES[expectedCaptionRevision]
    : null;
  if (
    expectedPipeline &&
    envelope.schemaVersion !== expectedPipeline.schemaVersion
  ) {
    throw new Error("Caption envelope revision does not match its schema.");
  }
  return envelope;
}

export function buildPetVisionCaptionText(caption) {
  const lines = [
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
  ];
  if ("accessories" in caption) {
    lines.push(
      `accessories_en: ${caption.accessories.en}`,
      `accessories_ru: ${caption.accessories.ru}`,
      `distinctive_features_en: ${caption.distinctive_features.en}`,
      `distinctive_features_ru: ${caption.distinctive_features.ru}`,
      `pose_motion_en: ${caption.pose_motion.en}`,
      `pose_motion_ru: ${caption.pose_motion.ru}`,
    );
  }
  lines.push(
    `search_terms_en: ${caption.search_terms_en.join(", ")}`,
    `search_terms_ru: ${caption.search_terms_ru.join(", ")}`,
  );
  return lines.join("\n");
}

export function createPetVisionCaptionSourceHash(input) {
  const pipeline =
    PET_VISION_PIPELINES[input.captionRevision] ??
    PET_VISION_PIPELINES[PET_VISION_CAPTION_REVISION_V1];
  const sharedParts = [
    input.captionRevision,
    input.modelUri,
    pipeline.systemPrompt,
    pipeline.userPrompt,
    JSON.stringify(pipeline.responseJsonSchema),
    pipeline.framePolicy.id,
    JSON.stringify(pipeline.framePolicy.frames),
  ];
  if (pipeline.schemaVersion === 2) {
    sharedParts.push(
      pipeline.api,
      pipeline.modelName,
      JSON.stringify(pipeline.tokenPolicy),
    );
  }
  return lengthPrefixedSha256([
    ...sharedParts,
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
    failed: 0,
    failedSlugs: [],
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
        if (!input.options.continueOnError) throw failure;
        summary.failed += 1;
        summary.failedSlugs.push(pet.slug);
      }
    }

    input.log({ action: "summary", ...summary });
    if (summary.failed > 0) {
      throw new PetVisionBackfillError("partial_failure");
    }
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
    extracted = await input.extractFrames(
      spritesheet,
      requirePetVisionPipeline(input.config.captionRevision).framePolicy,
    );
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
    captionRevision: input.config.captionRevision,
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
      captionRevision: input.config.captionRevision,
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
      input.captionRevision,
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("caption envelope must be an object.");
  }
  const schemaVersion = input.schemaVersion;
  const envelope = strictObject(
    input,
    "caption envelope",
    schemaVersion === 2
      ? ["schemaVersion", "source", "provenance", "caption"]
      : ["schemaVersion", "source", "caption"],
  );
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error("Caption envelope schemaVersion must be 1 or 2.");
  }
  const sourceValue = strictObject(envelope.source, "source", [
    "assetId",
    "spritesheetSha256",
  ]);
  const assetId = normalizedString(
    sourceValue.assetId,
    "source.assetId",
    1,
    256,
  );
  const spritesheetSha256 = normalizedString(
    sourceValue.spritesheetSha256,
    "source.spritesheetSha256",
    64,
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(spritesheetSha256)) {
    throw new Error("source.spritesheetSha256 must be lowercase SHA-256.");
  }
  const source = { assetId, spritesheetSha256 };
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      source,
      caption: parsePetVisionCaption(envelope.caption),
    };
  }
  const pipeline = requirePetVisionPipeline(
    PET_VISION_CAPTION_REVISION_V2,
  );
  const provenance = strictObject(envelope.provenance, "provenance", [
    "origin",
    "api",
    "model",
    "framePolicy",
  ]);
  if (
    provenance.origin !== "provider" ||
    provenance.api !== "responses" ||
    provenance.model !== pipeline.modelName ||
    provenance.framePolicy !== pipeline.framePolicy.id
  ) {
    throw new Error("Caption envelope contains invalid V2 provenance.");
  }
  return {
    schemaVersion: 2,
    source,
    provenance: {
      origin: "provider",
      api: "responses",
      model: pipeline.modelName,
      framePolicy: pipeline.framePolicy.id,
    },
    caption: parsePetVisionCaptionForRevision(
      envelope.caption,
      PET_VISION_CAPTION_REVISION_V2,
    ),
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
