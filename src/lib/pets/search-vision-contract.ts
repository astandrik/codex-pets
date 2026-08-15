import { createHash } from "node:crypto";

import { z } from "zod";

import { PET_VISION_FRAME_POLICY } from "@/lib/pets/search-vision-frames";

export const PET_VISION_CAPTION_REVISION =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
export const PET_VISUAL_MODEL_REVISION =
  "yandex-text-search-2026-07-pet-vision-v1";

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
} as const;

const requiredBilingualTextSchema = bilingualTextSchema(320, true);
const optionalBilingualTextSchema = bilingualTextSchema(240, false);
const colorListSchema = stringListSchema(1, 8, 40);
const searchTermListSchema = stringListSchema(3, 20, 60);

export const PET_VISION_CAPTION_SCHEMA = z
  .object({
    subject: requiredBilingualTextSchema,
    appearance: requiredBilingualTextSchema,
    clothing: optionalBilingualTextSchema,
    style: requiredBilingualTextSchema,
    mood: requiredBilingualTextSchema,
    colors: z
      .object({
        en: colorListSchema,
        ru: colorListSchema,
      })
      .strict(),
    search_terms_en: searchTermListSchema,
    search_terms_ru: searchTermListSchema,
  })
  .strict();

export type BilingualText = z.infer<typeof requiredBilingualTextSchema>;
export type PetVisionCaption = z.infer<typeof PET_VISION_CAPTION_SCHEMA>;

export type PetVisionCaptionEnvelope = {
  schemaVersion: 1;
  source: {
    assetId: string;
    spritesheetSha256: string;
  };
  caption: PetVisionCaption;
};

export function parsePetVisionCaption(input: unknown): PetVisionCaption {
  const result = PET_VISION_CAPTION_SCHEMA.safeParse(input);
  if (result.success) return result.data;
  throw new Error(formatCaptionIssue(result.error.issues[0], input));
}

export function createPetVisionCaptionEnvelope(input: {
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaption;
}): PetVisionCaptionEnvelope {
  return parseEnvelopeValue({
    schemaVersion: 1,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(
  value: string,
): PetVisionCaptionEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  return parseEnvelopeValue(parsed);
}

export function buildPetVisionCaptionText(
  caption: PetVisionCaption,
): string {
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

export function createPetVisionCaptionSourceHash(input: {
  captionRevision: string;
  modelUri: string;
  assetId: string;
  spritesheetSha256: string;
}): string {
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

export function createPetVisualEmbeddingSourceHash(input: {
  visualRevision: string;
  captionRevision: string;
  captionSourceHash: string;
  captionText: string;
}): string {
  return lengthPrefixedSha256([
    input.visualRevision,
    input.captionRevision,
    input.captionSourceHash,
    input.captionText,
  ]);
}

function parseEnvelopeValue(input: unknown): PetVisionCaptionEnvelope {
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

function bilingualTextSchema(maxLength: number, required: boolean) {
  return z
    .object({
      en: normalizedStringSchema(required ? 1 : 0, maxLength),
      ru: normalizedStringSchema(required ? 1 : 0, maxLength),
    })
    .strict();
}

function stringListSchema(
  minItems: number,
  maxItems: number,
  maxLength: number,
) {
  return z
    .array(normalizedStringSchema(1, maxLength))
    .max(maxItems)
    .transform((items) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = item.toLocaleLowerCase("und");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .pipe(z.array(z.string()).min(minItems));
}

function normalizedStringSchema(minLength: number, maxLength: number) {
  return z
    .string()
    .transform((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(minLength).max(maxLength));
}

function formatCaptionIssue(
  issue: z.core.$ZodIssue | undefined,
  input: unknown,
): string {
  if (!issue) return "Caption does not match the expected schema.";
  const path = issue.path.map(String).join(".") || "caption";
  if (issue.code === "unrecognized_keys") {
    return `${path} contains unknown field ${issue.keys[0] ?? "unknown"}.`;
  }
  if (issue.code === "invalid_type") {
    if (!hasPath(input, issue.path)) {
      const field = String(issue.path.at(-1) ?? "value");
      const parent = issue.path.slice(0, -1).map(String).join(".") || "caption";
      return `${parent} is missing field ${field}.`;
    }
    return `${path} must be ${articleFor(issue.expected)} ${issue.expected}.`;
  }
  if (issue.code === "too_big") {
    return `${path} must contain at most ${issue.maximum} ${issue.origin}.`;
  }
  if (issue.code === "too_small") {
    return `${path} must contain at least ${issue.minimum} ${issue.origin}.`;
  }
  return `${path} does not match the expected schema.`;
}

function hasPath(input: unknown, path: readonly PropertyKey[]): boolean {
  let value = input;
  for (const segment of path) {
    if (!value || typeof value !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return false;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return true;
}

function articleFor(value: string): "a" | "an" {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

function normalizedString(
  input: unknown,
  path: string,
  minLength: number,
  maxLength: number,
): string {
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

function strictObject<const T extends readonly string[]>(
  input: unknown,
  path: string,
  fields: T,
): Record<T[number], unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path} must be an object.`);
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set<string>(fields);
  const unknownField = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownField) {
    throw new Error(`${path} contains unknown field ${unknownField}.`);
  }
  const missingField = fields.find(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (missingField) {
    throw new Error(`${path} is missing field ${missingField}.`);
  }
  return value as Record<T[number], unknown>;
}

function lengthPrefixedSha256(parts: readonly (string | Buffer)[]): string {
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
