import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  embeddingToBuffer as runtimeEmbeddingToBuffer,
} from "../src/lib/pets/search-embeddings";
import {
  PET_VISION_V3_CANARIES as RUNTIME_VISION_V3_CANARIES,
  PET_VISION_V2_CANARIES as RUNTIME_VISION_CANARIES,
  evaluatePetVisionCanary as evaluateRuntimeCanary,
  evaluatePetVisionV3Canary as evaluateRuntimeV3Canary,
} from "../src/lib/pets/search-vision-canaries";
import {
  PET_VISION_CAPTION_CONTRACTS as RUNTIME_CAPTION_CONTRACTS,
  PET_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISION_CAPTION_REVISION_V3,
  PET_VISUAL_MODEL_REVISION,
  PET_VISUAL_MODEL_REVISION_V2,
  PET_VISUAL_MODEL_REVISION_V3,
  buildPetVisionCaptionText as buildRuntimeCaptionText,
  createPetVisionCaptionEnvelope as createRuntimeCaptionEnvelope,
  createPetVisionCaptionSourceHash as createRuntimeCaptionHash,
  createPetVisualEmbeddingSourceHash as createRuntimeVisualHash,
  type PetVisionCaptionV3,
} from "../src/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY as RUNTIME_FRAME_POLICY,
  extractPetVisionFrames as extractRuntimeFrames,
} from "../src/lib/pets/search-vision-frames";
import type {
  VisionBackfillCaption,
  VisionBackfillCaptionV1,
  VisionBackfillCaptionV2,
  VisionBackfillCaptionV3,
} from "./lib/pet-vision-search-backfill.mjs";

const {
  PET_VISION_CAPTION_CONTRACTS,
  PET_VISION_V2_CANARIES,
  PET_VISION_V3_CANARIES,
  PET_VISUAL_MODEL_REVISIONS,
  PET_VISION_FRAME_POLICY,
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  embeddingToBuffer,
  evaluatePetVisionCanary,
  evaluatePetVisionV3Canary,
  extractPetVisionFrames,
  parsePetVisionCaption,
  parseVisionBackfillArgs,
  resolvePetVisionRevisionConfig,
  runPetVisionSearchBackfill,
} = await import("./lib/pet-vision-search-backfill.mjs");

const visualConfig = {
  captionRevision: PET_VISION_CAPTION_REVISION,
  visualRevision: PET_VISUAL_MODEL_REVISION,
  dimensions: 256,
  modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
};
const v3VisualConfig = {
  captionRevision: PET_VISION_CAPTION_REVISION_V3,
  visualRevision: PET_VISUAL_MODEL_REVISION_V3,
  dimensions: 256,
  modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
};
const pet = {
  slug: "velvet-byte",
  status: "approved",
  spritesheetUrl: "/api/assets/asset-velvet/spritesheet.webp",
};
const caption = {
  subject: { en: "woman", ru: "женщина" },
  appearance: { en: "silver hair", ru: "серебряные волосы" },
  clothing: { en: "black dress", ru: "чёрное платье" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенная" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["anime woman", "gothic", "elegant"],
  search_terms_ru: ["аниме девушка", "готика", "элегантная"],
};
const v2Caption = {
  ...caption,
  accessories: {
    en: "black blindfold and sword",
    ru: "чёрная повязка и меч",
  },
};
const passingFischlCaption = {
  ...caption,
  appearance: {
    en: "blonde hair and one eye covered",
    ru: "светлые волосы и закрытый глаз",
  },
  clothing: {
    en: "purple outfit with black clothing",
    ru: "фиолетовый наряд и чёрная одежда",
  },
  accessories: {
    en: "dark eye covering",
    ru: "чёрная повязка на глаз",
  },
};
const failingFischlCaption = {
  ...passingFischlCaption,
  appearance: {
    en: "blonde hair",
    ru: "светлые волосы",
  },
  accessories: { en: "", ru: "" },
};
const v3BaseCaption: PetVisionCaptionV3 = {
  subject: { en: "animated companion", ru: "анимированный спутник" },
  appearance: { en: "detailed sprite", ru: "детализированный спрайт" },
  visual_attributes: {
    hair_and_headwear: { present: false, en: "", ru: "" },
    face_and_eye_coverings: { present: false, en: "", ru: "" },
    clothing_and_armor: { present: false, en: "", ru: "" },
    weapons_and_objects: { present: false, en: "", ru: "" },
    visible_effects: { present: false, en: "", ru: "" },
    other_distinguishing_features: { present: false, en: "", ru: "" },
  },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенный" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["animated pet", "pixel companion", "sprite art"],
  search_terms_ru: ["анимированный питомец", "пиксельный спутник", "спрайт"],
};
const v3Captions: Record<string, PetVisionCaptionV3> = {
  "fischl-detailed": {
    ...v3BaseCaption,
    visual_attributes: {
      ...v3BaseCaption.visual_attributes,
      hair_and_headwear: {
        present: true,
        en: "blonde hair",
        ru: "светлые волосы",
      },
      face_and_eye_coverings: {
        present: true,
        en: "black eye patch",
        ru: "чёрная повязка на глаз",
      },
      clothing_and_armor: {
        present: true,
        en: "purple outfit and black clothing",
        ru: "фиолетовый наряд и чёрная одежда",
      },
    },
  },
  "2b-2": {
    ...v3BaseCaption,
    visual_attributes: {
      ...v3BaseCaption.visual_attributes,
      hair_and_headwear: {
        present: true,
        en: "silver hair",
        ru: "серебряные волосы",
      },
      face_and_eye_coverings: {
        present: true,
        en: "black blindfold",
        ru: "чёрная повязка на глаз",
      },
      clothing_and_armor: {
        present: true,
        en: "black clothing",
        ru: "чёрная одежда",
      },
      weapons_and_objects: { present: true, en: "sword", ru: "меч" },
    },
  },
  "master-of-terra": {
    ...v3BaseCaption,
    visual_attributes: {
      ...v3BaseCaption.visual_attributes,
      clothing_and_armor: {
        present: true,
        en: "golden armor and red cloak",
        ru: "золотая броня и красный плащ",
      },
      weapons_and_objects: { present: true, en: "sword", ru: "меч" },
      visible_effects: { present: true, en: "flames", ru: "пламя" },
    },
  },
  vi: {
    ...v3BaseCaption,
    visual_attributes: {
      ...v3BaseCaption.visual_attributes,
      hair_and_headwear: {
        present: true,
        en: "pink hair",
        ru: "розовые волосы",
      },
      weapons_and_objects: {
        present: true,
        en: "massive gauntlets",
        ru: "массивные перчатки",
      },
    },
  },
};
const v3CanaryPets = [
  {
    slug: "fischl-detailed",
    status: "approved",
    spritesheetUrl: "/api/assets/asset-fischl/spritesheet.webp",
  },
  {
    slug: "2b-2",
    status: "approved",
    spritesheetUrl: "/api/assets/asset-2b/spritesheet.webp",
  },
  {
    slug: "master-of-terra",
    status: "approved",
    spritesheetUrl: "/api/assets/asset-master/spritesheet.webp",
  },
  {
    slug: "vi",
    status: "approved",
    spritesheetUrl: "/api/assets/asset-vi/spritesheet.webp",
  },
];
const spritesheetSha256 = "a".repeat(64);
const frames = PET_VISION_FRAME_POLICY.frames.map(
  ({ state, row, frame }: { state: string; row: number; frame: number }) => ({
    state,
    row,
    frame,
    png: Buffer.from(state),
    dataUrl: `data:image/png;base64,${Buffer.from(state).toString("base64")}`,
  }),
);

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    options: {
      mode: "apply" as const,
      slug: null,
      force: false,
      canaries: false,
    },
    config: visualConfig,
    pets: [pet],
    readSpritesheet: vi.fn(async () => Buffer.from("atlas")),
    extractFrames: vi.fn(async () => ({
      spriteVersion: 1,
      spritesheetSha256,
      frames,
    })),
    getCaption: vi.fn(async () => null),
    getEmbeddingMetadata: vi.fn(async () => null),
    createCaption: vi.fn(async () => caption),
    embedDocument: vi.fn(async () => Array(256).fill(0.25)),
    upsertCaption: vi.fn(async () => undefined),
    upsertEmbedding: vi.fn(async () => undefined),
    now: () => new Date("2026-07-23T00:00:00.000Z"),
    log: vi.fn(),
    ...overrides,
  };
}

function freshCaption() {
  const captionText = buildPetVisionCaptionText(caption);
  const sourceHash = createPetVisionCaptionSourceHash({
    captionRevision: visualConfig.captionRevision,
    modelUri: visualConfig.modelUri,
    assetId: "asset-velvet",
    spritesheetSha256,
  });
  return {
    slug: pet.slug,
    sourceHash,
    captionJson: JSON.stringify(
      createPetVisionCaptionEnvelope({
        assetId: "asset-velvet",
        spritesheetSha256,
        caption,
      }),
    ),
    captionText,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

const v3AssetIds: Record<string, string> = {
  "fischl-detailed": "asset-fischl",
  "2b-2": "asset-2b",
  "master-of-terra": "asset-master",
  vi: "asset-vi",
};

function storedV3Caption(
  slug: string,
  sha256 = spritesheetSha256,
) {
  const caption = v3Captions[slug];
  const assetId = v3AssetIds[slug];
  const captionText = buildRuntimeCaptionText(
    PET_VISION_CAPTION_REVISION_V3,
    caption,
  );
  return {
    slug,
    sourceHash: createRuntimeCaptionHash({
      captionRevision: PET_VISION_CAPTION_REVISION_V3,
      modelUri: v3VisualConfig.modelUri,
      assetId,
      spritesheetSha256: sha256,
    }),
    captionJson: JSON.stringify(
      createRuntimeCaptionEnvelope({
        captionRevision: PET_VISION_CAPTION_REVISION_V3,
        assetId,
        spritesheetSha256: sha256,
        caption,
      }),
    ),
    captionText,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

function v3Dependencies(overrides: Record<string, unknown> = {}) {
  const captions = v3CanaryPets.map(({ slug }) => v3Captions[slug]);
  return dependencies({
    options: {
      mode: "apply" as const,
      slug: null,
      force: false,
      canaries: true,
    },
    config: v3VisualConfig,
    pets: v3CanaryPets,
    createCaption: vi.fn(async () => captions.shift() ?? v3BaseCaption),
    ...overrides,
  });
}

describe("pet vision search backfill", () => {
  it("keeps revision-specific CLI caption types and overloads", () => {
    type V1RequiresClothing =
      Pick<VisionBackfillCaptionV1, "clothing"> extends Required<
        Pick<VisionBackfillCaptionV1, "clothing">
      >
        ? true
        : false;
    type V3RequiresVisualAttributes =
      Pick<
        VisionBackfillCaptionV3,
        "visual_attributes"
      > extends Required<
        Pick<VisionBackfillCaptionV3, "visual_attributes">
      >
        ? true
        : false;

    expectTypeOf<V1RequiresClothing>().toEqualTypeOf<true>();
    expectTypeOf<V3RequiresVisualAttributes>().toEqualTypeOf<true>();
    expectTypeOf<VisionBackfillCaptionV2["accessories"]>()
      .toEqualTypeOf<{ en: string; ru: string }>();
    expectTypeOf(
      parsePetVisionCaption(caption),
    ).toEqualTypeOf<VisionBackfillCaptionV1>();
    expectTypeOf(
      parsePetVisionCaption(PET_VISION_CAPTION_REVISION_V2, v2Caption),
    ).toEqualTypeOf<VisionBackfillCaptionV2>();
    expectTypeOf(
      parsePetVisionCaption(
        PET_VISION_CAPTION_REVISION_V3,
        v3BaseCaption,
      ),
    ).toEqualTypeOf<VisionBackfillCaptionV3>();
    expectTypeOf(evaluatePetVisionV3Canary)
      .parameter(1)
      .toEqualTypeOf<VisionBackfillCaptionV3>();
    expectTypeOf<VisionBackfillCaption>()
      .toEqualTypeOf<
        | VisionBackfillCaptionV1
        | VisionBackfillCaptionV2
        | VisionBackfillCaptionV3
      >();
  });

  it("keeps the frozen v3 contract, canaries, and evaluator in runtime parity", () => {
    expect(PET_VISION_V3_CANARIES).toEqual(RUNTIME_VISION_V3_CANARIES);
    expect(
      PET_VISION_CAPTION_CONTRACTS[PET_VISION_CAPTION_REVISION_V3],
    ).toEqual(RUNTIME_CAPTION_CONTRACTS[PET_VISION_CAPTION_REVISION_V3]);
    expect(
      evaluatePetVisionV3Canary(
        "master-of-terra",
        v3Captions["master-of-terra"],
      ),
    ).toEqual(
      evaluateRuntimeV3Canary(
        "master-of-terra",
        v3Captions["master-of-terra"],
      ),
    );
    expect(
      resolvePetVisionRevisionConfig(
        PET_VISION_CAPTION_REVISION_V3,
        PET_VISUAL_MODEL_REVISION_V3,
      ).captionContract.maxTokens,
    ).toBe(1200);
  });

  it("keeps the frozen canary registry and evaluator in runtime parity", () => {
    expect(PET_VISION_V2_CANARIES).toEqual(RUNTIME_VISION_CANARIES);
    const captionText = buildPetVisionCaptionText(
      PET_VISION_CAPTION_REVISION_V2,
      passingFischlCaption,
    );
    expect(
      evaluatePetVisionCanary("fischl-detailed", captionText),
    ).toEqual(evaluateRuntimeCanary("fischl-detailed", captionText));
  });

  it("checks v2 canaries before writes and logs booleans only", async () => {
    const canaryPet = {
      slug: "fischl-detailed",
      status: "approved",
      spritesheetUrl: "/api/assets/asset-fischl/spritesheet.webp",
    };
    const input = dependencies({
      options: {
        mode: "apply" as const,
        slug: canaryPet.slug,
        force: true,
      },
      config: {
        ...visualConfig,
        captionRevision: PET_VISION_CAPTION_REVISION_V2,
        visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      },
      pets: [canaryPet],
      createCaption: vi.fn(async () => failingFischlCaption),
      log: vi.fn(),
    });

    await expect(runPetVisionSearchBackfill(input)).rejects.toMatchObject({
      reason: "canary_failed",
    });
    expect(input.upsertCaption).not.toHaveBeenCalled();
    expect(input.upsertEmbedding).not.toHaveBeenCalled();
    const output = JSON.stringify(input.log.mock.calls);
    expect(output).toContain("dark_eye_covering");
    expect(output).toContain('"passed":false');
    expect(output).not.toContain("blonde hair");
    expect(output).not.toContain("data:image");
  });

  it("runs all v2 canaries before any non-canary full-backfill write", async () => {
    const readSpritesheet = vi.fn(async () => Buffer.from("atlas"));
    const input = dependencies({
      config: {
        ...visualConfig,
        captionRevision: PET_VISION_CAPTION_REVISION_V2,
        visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      },
      pets: [
        pet,
        {
          slug: "fischl-detailed",
          status: "approved",
          spritesheetUrl:
            "/api/assets/asset-fischl/spritesheet.webp",
        },
        {
          slug: "2b-2",
          status: "approved",
          spritesheetUrl: "/api/assets/asset-2b/spritesheet.webp",
        },
        {
          slug: "master-of-terra",
          status: "approved",
          spritesheetUrl:
            "/api/assets/asset-master/spritesheet.webp",
        },
        {
          slug: "vi",
          status: "approved",
          spritesheetUrl: "/api/assets/asset-vi/spritesheet.webp",
        },
      ],
      readSpritesheet,
      createCaption: vi.fn(async () => failingFischlCaption),
      log: vi.fn(),
    });

    await expect(runPetVisionSearchBackfill(input)).rejects.toMatchObject({
      reason: "canary_failed",
    });
    expect(readSpritesheet).toHaveBeenCalledTimes(1);
    expect(readSpritesheet).toHaveBeenCalledWith("asset-fischl");
    expect(input.upsertCaption).not.toHaveBeenCalled();
  });

  it("accepts only registered matching caption and visual revisions", () => {
    expect(
      resolvePetVisionRevisionConfig(
        PET_VISION_CAPTION_REVISION_V2,
        PET_VISUAL_MODEL_REVISION_V2,
      ),
    ).toMatchObject({
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      dimensions: 256,
      captionContract:
        PET_VISION_CAPTION_CONTRACTS[PET_VISION_CAPTION_REVISION_V2],
    });
    expect(PET_VISUAL_MODEL_REVISIONS[PET_VISUAL_MODEL_REVISION_V2])
      .toMatchObject({
        captionRevision: PET_VISION_CAPTION_REVISION_V2,
        dimensions: 256,
      });
    expect(() =>
      resolvePetVisionRevisionConfig(
        PET_VISION_CAPTION_REVISION_V2,
        PET_VISUAL_MODEL_REVISION,
      ),
    ).toThrow(/matching caption and visual revisions/i);
  });

  it("accepts only explicit supported modes and apply-only force", () => {
    expect(parseVisionBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
      canaries: false,
    });
    expect(
      parseVisionBackfillArgs([
        "--apply",
        "--slug=velvet-byte",
        "--force",
      ]),
    ).toEqual({
      mode: "apply",
      slug: "velvet-byte",
      force: true,
      canaries: false,
    });
    expect(() => parseVisionBackfillArgs([])).toThrow(
      /--dry-run.*--apply/,
    );
    expect(() =>
      parseVisionBackfillArgs(["--dry-run", "--force"]),
    ).toThrow(/force.*apply/i);
    expect(() =>
      parseVisionBackfillArgs(["--apply", "--unknown"]),
    ).toThrow(/unknown argument/i);
  });

  it("parses --canaries and rejects its invalid argument combinations", () => {
    expect(parseVisionBackfillArgs(["--dry-run", "--canaries"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
      canaries: true,
    });
    expect(
      parseVisionBackfillArgs(["--apply", "--canaries", "--force"]),
    ).toEqual({
      mode: "apply",
      slug: null,
      force: true,
      canaries: true,
    });
    expect(() =>
      parseVisionBackfillArgs([
        "--apply",
        "--canaries",
        "--slug=velvet-byte",
      ]),
    ).toThrow(/canaries.*slug/i);
  });

  it("keeps frame constants, canonical text, hashes, and vector encoding in runtime parity", () => {
    expect(PET_VISION_FRAME_POLICY).toEqual(RUNTIME_FRAME_POLICY);
    expect(buildPetVisionCaptionText(caption)).toBe(
      buildRuntimeCaptionText(caption),
    );

    const captionHashInput = {
      captionRevision: visualConfig.captionRevision,
      modelUri: visualConfig.modelUri,
      assetId: "asset-velvet",
      spritesheetSha256,
    };
    const captionSourceHash =
      createPetVisionCaptionSourceHash(captionHashInput);
    expect(captionSourceHash).toBe(
      createRuntimeCaptionHash(captionHashInput),
    );
    const visualHashInput = {
      visualRevision: visualConfig.visualRevision,
      captionRevision: visualConfig.captionRevision,
      captionSourceHash,
      captionText: buildPetVisionCaptionText(caption),
    };
    expect(createPetVisualEmbeddingSourceHash(visualHashInput)).toBe(
      createRuntimeVisualHash(visualHashInput),
    );
    expect(embeddingToBuffer([1.5, -2.25])).toEqual(
      runtimeEmbeddingToBuffer([1.5, -2.25]),
    );
  });

  it("keeps the v2 contract, envelope, canonical text, and hashes in runtime parity", () => {
    expect(PET_VISION_CAPTION_CONTRACTS[PET_VISION_CAPTION_REVISION_V2])
      .toEqual(RUNTIME_CAPTION_CONTRACTS[PET_VISION_CAPTION_REVISION_V2]);
    const scriptText = buildPetVisionCaptionText(
      PET_VISION_CAPTION_REVISION_V2,
      v2Caption,
    );
    expect(scriptText).toBe(
      buildRuntimeCaptionText(
        PET_VISION_CAPTION_REVISION_V2,
        v2Caption,
      ),
    );
    const scriptEnvelope = createPetVisionCaptionEnvelope({
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      assetId: "asset-velvet",
      spritesheetSha256,
      caption: v2Caption,
    });
    expect(scriptEnvelope).toEqual(
      createRuntimeCaptionEnvelope({
        captionRevision: PET_VISION_CAPTION_REVISION_V2,
        assetId: "asset-velvet",
        spritesheetSha256,
        caption: v2Caption,
      }),
    );
    expect(scriptEnvelope.schemaVersion).toBe(2);

    const captionHashInput = {
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      modelUri: visualConfig.modelUri,
      assetId: "asset-velvet",
      spritesheetSha256,
    };
    const captionSourceHash =
      createPetVisionCaptionSourceHash(captionHashInput);
    expect(captionSourceHash).toBe(
      createRuntimeCaptionHash(captionHashInput),
    );
    const visualHashInput = {
      visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      captionSourceHash,
      captionText: scriptText,
    };
    expect(createPetVisualEmbeddingSourceHash(visualHashInput)).toBe(
      createRuntimeVisualHash(visualHashInput),
    );
  });

  it("keeps non-PNG/WebP rejection in runtime parity", async () => {
    const gif = Buffer.from("GIF89a", "ascii");

    await expect(extractPetVisionFrames(gif)).rejects.toThrow(
      /sprite image format/i,
    );
    await expect(extractRuntimeFrames(gif)).rejects.toThrow(
      /sprite image format/i,
    );
  });

  it("dry-run reads and hashes assets without provider calls or writes", async () => {
    const input = dependencies({
      options: { mode: "dry-run", slug: null, force: false },
    });

    const summary = await runPetVisionSearchBackfill(input);

    expect(summary).toEqual({
      scanned: 1,
      unchanged: 0,
      vectorOnly: 0,
      captionAndVector: 1,
    });
    expect(input.readSpritesheet).toHaveBeenCalledWith("asset-velvet");
    expect(input.extractFrames).toHaveBeenCalledOnce();
    expect(input.createCaption).not.toHaveBeenCalled();
    expect(input.embedDocument).not.toHaveBeenCalled();
    expect(input.upsertCaption).not.toHaveBeenCalled();
    expect(input.upsertEmbedding).not.toHaveBeenCalled();
    expect(JSON.stringify(input.log.mock.calls)).toContain("velvet-byte");
    expect(JSON.stringify(input.log.mock.calls)).not.toContain("silver hair");
    expect(JSON.stringify(input.log.mock.calls)).not.toContain("data:image");
  });

  it("reports unchanged and vector-only states without calling vision", async () => {
    const storedCaption = freshCaption();
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: visualConfig.visualRevision,
      captionRevision: visualConfig.captionRevision,
      captionSourceHash: storedCaption.sourceHash,
      captionText: storedCaption.captionText,
    });
    const unchangedInput = dependencies({
      getCaption: vi.fn(async () => storedCaption),
      getEmbeddingMetadata: vi.fn(async () => ({
        sourceHash: visualSourceHash,
        dimensions: 256,
      })),
    });
    const unchanged = await runPetVisionSearchBackfill(unchangedInput);
    expect(unchanged.unchanged).toBe(1);
    expect(unchangedInput.createCaption).not.toHaveBeenCalled();
    expect(unchangedInput.embedDocument).not.toHaveBeenCalled();

    const vectorInput = dependencies({
      getCaption: vi.fn(async () => storedCaption),
    });
    const vectorOnly = await runPetVisionSearchBackfill(vectorInput);
    expect(vectorOnly.vectorOnly).toBe(1);
    expect(vectorInput.createCaption).not.toHaveBeenCalled();
    expect(vectorInput.embedDocument).toHaveBeenCalledWith(
      storedCaption.captionText,
    );
    expect(vectorInput.upsertEmbedding).toHaveBeenCalledWith({
      modelRevision: visualConfig.visualRevision,
      slug: pet.slug,
      sourceHash: visualSourceHash,
      dimensions: 256,
      embedding: Array(256).fill(0.25),
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
  });

  it("forces caption then vector and preserves resumable partial progress", async () => {
    const writes: string[] = [];
    const firstRun = dependencies({
      options: { mode: "apply", slug: pet.slug, force: true },
      upsertCaption: vi.fn(async () => {
        writes.push("caption");
      }),
      embedDocument: vi.fn(async () => {
        writes.push("embedding-failed");
        throw Object.assign(new Error("secret payload"), {
          reason: "provider_error",
        });
      }),
      log: vi.fn(),
    });

    await expect(runPetVisionSearchBackfill(firstRun)).rejects.toMatchObject({
      reason: "provider_error",
    });
    expect(writes).toEqual(["caption", "embedding-failed"]);
    expect(JSON.stringify(firstRun.log.mock.calls)).not.toContain(
      "secret payload",
    );

    const resumed = dependencies({
      getCaption: vi.fn(async () => freshCaption()),
    });
    const summary = await runPetVisionSearchBackfill(resumed);
    expect(summary.vectorOnly).toBe(1);
    expect(resumed.createCaption).not.toHaveBeenCalled();
  });

  it("selects exactly four v3 canaries in frozen order for dry-run", async () => {
    const input = v3Dependencies({
      options: {
        mode: "dry-run" as const,
        slug: null,
        force: false,
        canaries: true,
      },
      pets: [pet, ...v3CanaryPets.toReversed()],
    });

    const summary = await runPetVisionSearchBackfill(input);

    expect(summary.scanned).toBe(4);
    expect(
      (
        input.readSpritesheet.mock.calls as unknown as Array<[string]>
      ).map(([assetId]) => assetId),
    ).toEqual(["asset-fischl", "asset-2b", "asset-master", "asset-vi"]);
    expect(input.extractFrames).toHaveBeenCalledTimes(4);
    expect(input.createCaption).not.toHaveBeenCalled();
    expect(input.embedDocument).not.toHaveBeenCalled();
    expect(input.upsertCaption).not.toHaveBeenCalled();
    expect(input.upsertEmbedding).not.toHaveBeenCalled();
  });

  it("rejects missing canaries, mismatched revisions, and single v3 canary slugs", async () => {
    const missing = v3Dependencies({ pets: v3CanaryPets.slice(0, 3) });
    await expect(runPetVisionSearchBackfill(missing)).rejects.toMatchObject({
      reason: "canary_failed",
    });
    expect(missing.readSpritesheet).not.toHaveBeenCalled();

    const wrongRevision = dependencies({
      options: {
        mode: "dry-run" as const,
        slug: null,
        force: false,
        canaries: true,
      },
    });
    await expect(
      runPetVisionSearchBackfill(wrongRevision),
    ).rejects.toThrow(/canaries.*v3/i);

    const wrongDimensions = v3Dependencies({
      options: {
        mode: "dry-run" as const,
        slug: null,
        force: false,
        canaries: true,
      },
      config: { ...v3VisualConfig, dimensions: 512 },
    });
    await expect(
      runPetVisionSearchBackfill(wrongDimensions),
    ).rejects.toThrow(/canaries.*v3/i);
    expect(wrongDimensions.readSpritesheet).not.toHaveBeenCalled();

    const single = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: "fischl-detailed",
        force: true,
        canaries: false,
      },
    });
    await expect(runPetVisionSearchBackfill(single)).rejects.toThrow(
      /individual v3 canary/i,
    );
    expect(single.readSpritesheet).not.toHaveBeenCalled();
  });

  it("stages every caption and check before any v3 canary write", async () => {
    let captionCall = 0;
    const fourthProviderFailure = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: null,
        force: true,
        canaries: true,
      },
      createCaption: vi.fn(async () => {
        const slug = v3CanaryPets[captionCall++].slug;
        if (captionCall === 4) {
          throw Object.assign(new Error("private provider payload"), {
            reason: "provider_error",
          });
        }
        return v3Captions[slug];
      }),
    });
    await expect(
      runPetVisionSearchBackfill(fourthProviderFailure),
    ).rejects.toMatchObject({ reason: "provider_error" });
    expect(fourthProviderFailure.upsertCaption).not.toHaveBeenCalled();
    expect(fourthProviderFailure.upsertEmbedding).not.toHaveBeenCalled();

    captionCall = 0;
    const fourthCanaryMiss = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: null,
        force: true,
        canaries: true,
      },
      createCaption: vi.fn(async () => {
        const slug = v3CanaryPets[captionCall++].slug;
        return captionCall === 4 ? v3BaseCaption : v3Captions[slug];
      }),
    });
    await expect(
      runPetVisionSearchBackfill(fourthCanaryMiss),
    ).rejects.toMatchObject({ reason: "canary_failed" });
    expect(fourthCanaryMiss.embedDocument).not.toHaveBeenCalled();
    expect(fourthCanaryMiss.upsertCaption).not.toHaveBeenCalled();
    expect(fourthCanaryMiss.upsertEmbedding).not.toHaveBeenCalled();
  });

  it("leaves both v3 upserts at zero when the fourth embedding fails", async () => {
    let embeddingCall = 0;
    const input = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: null,
        force: true,
        canaries: true,
      },
      embedDocument: vi.fn(async () => {
        embeddingCall += 1;
        if (embeddingCall === 4) {
          throw Object.assign(new Error("private embedding payload"), {
            reason: "provider_error",
          });
        }
        return Array(256).fill(0.25);
      }),
    });

    await expect(runPetVisionSearchBackfill(input)).rejects.toMatchObject({
      reason: "provider_error",
    });
    expect(input.createCaption).toHaveBeenCalledTimes(4);
    expect(input.embedDocument).toHaveBeenCalledTimes(4);
    expect(input.upsertCaption).not.toHaveBeenCalled();
    expect(input.upsertEmbedding).not.toHaveBeenCalled();
  });

  it("persists four v3 pairs only after all eight provider results are staged and read back", async () => {
    const captionRows = new Map<string, ReturnType<typeof storedV3Caption>>();
    const vectorRows = new Map<
      string,
      { sourceHash: string; dimensions: number }
    >();
    const events: string[] = [];
    let captionCall = 0;
    const input = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: null,
        force: true,
        canaries: true,
      },
      createCaption: vi.fn(async () => {
        events.push("caption-provider");
        return v3Captions[v3CanaryPets[captionCall++].slug];
      }),
      embedDocument: vi.fn(async () => {
        events.push("embedding-provider");
        return Array(256).fill(0.25);
      }),
      getCaption: vi.fn(async (_revision: string, slug: string) =>
        captionRows.get(slug) ?? null,
      ),
      getEmbeddingMetadata: vi.fn(async (_revision: string, slug: string) =>
        vectorRows.get(slug) ?? null,
      ),
      upsertCaption: vi.fn(async (row) => {
        events.push(`caption-write:${row.slug}`);
        captionRows.set(row.slug, row);
      }),
      upsertEmbedding: vi.fn(async (row) => {
        events.push(`embedding-write:${row.slug}`);
        vectorRows.set(row.slug, {
          sourceHash: row.sourceHash,
          dimensions: row.dimensions,
        });
      }),
    });

    const summary = await runPetVisionSearchBackfill(input);

    expect(summary).toMatchObject({ scanned: 4, captionAndVector: 4 });
    expect(events.slice(0, 8)).toEqual([
      "caption-provider",
      "caption-provider",
      "caption-provider",
      "caption-provider",
      "embedding-provider",
      "embedding-provider",
      "embedding-provider",
      "embedding-provider",
    ]);
    expect(input.createCaption).toHaveBeenCalledTimes(4);
    expect(input.embedDocument).toHaveBeenCalledTimes(4);
    expect(input.upsertCaption).toHaveBeenCalledTimes(4);
    expect(input.upsertEmbedding).toHaveBeenCalledTimes(4);
    expect(input.getCaption.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(input.getEmbeddingMetadata.mock.calls.length).toBeGreaterThanOrEqual(
      4,
    );
    for (const canaryPet of v3CanaryPets) {
      const captionRow = captionRows.get(canaryPet.slug);
      const vectorRow = vectorRows.get(canaryPet.slug);
      expect(vectorRow?.sourceHash).toBe(
        createPetVisualEmbeddingSourceHash({
          visualRevision: PET_VISUAL_MODEL_REVISION_V3,
          captionRevision: PET_VISION_CAPTION_REVISION_V3,
          captionSourceHash: captionRow?.sourceHash ?? "",
          captionText: captionRow?.captionText ?? "",
        }),
      );
      expect(vectorRow?.dimensions).toBe(256);
    }
  });

  it("blocks ordinary v3 apply until the durable gate is open", async () => {
    const closed = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: pet.slug,
        force: false,
        canaries: false,
      },
      pets: [...v3CanaryPets, pet],
      getCaption: vi.fn(async () => null),
    });
    await expect(runPetVisionSearchBackfill(closed)).rejects.toMatchObject({
      reason: "canary_failed",
    });
    expect(closed.createCaption).not.toHaveBeenCalled();
    expect(closed.upsertCaption).not.toHaveBeenCalled();
    expect(closed.upsertEmbedding).not.toHaveBeenCalled();

    const targetText = buildRuntimeCaptionText(
      PET_VISION_CAPTION_REVISION_V3,
      v3BaseCaption,
    );
    const targetSourceHash = createRuntimeCaptionHash({
      captionRevision: PET_VISION_CAPTION_REVISION_V3,
      modelUri: v3VisualConfig.modelUri,
      assetId: "asset-velvet",
      spritesheetSha256,
    });
    const targetRow = {
      slug: pet.slug,
      sourceHash: targetSourceHash,
      captionJson: JSON.stringify(
        createRuntimeCaptionEnvelope({
          captionRevision: PET_VISION_CAPTION_REVISION_V3,
          assetId: "asset-velvet",
          spritesheetSha256,
          caption: v3BaseCaption,
        }),
      ),
      captionText: targetText,
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const rows = new Map([
      ...v3CanaryPets.map(({ slug }) => [slug, storedV3Caption(slug)] as const),
      [pet.slug, targetRow] as const,
    ]);
    const open = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: pet.slug,
        force: false,
        canaries: false,
      },
      pets: [...v3CanaryPets, pet],
      getCaption: vi.fn(async (_revision: string, slug: string) =>
        rows.get(slug) ?? null,
      ),
      getEmbeddingMetadata: vi.fn(async (_revision: string, slug: string) => {
        const row = rows.get(slug);
        return row
          ? {
              sourceHash: createPetVisualEmbeddingSourceHash({
                visualRevision: PET_VISUAL_MODEL_REVISION_V3,
                captionRevision: PET_VISION_CAPTION_REVISION_V3,
                captionSourceHash: row.sourceHash,
                captionText: row.captionText,
              }),
              dimensions: 256,
            }
          : null;
      }),
    });

    await expect(runPetVisionSearchBackfill(open)).resolves.toMatchObject({
      scanned: 1,
      unchanged: 1,
    });
    expect(open.createCaption).not.toHaveBeenCalled();
    expect(open.embedDocument).not.toHaveBeenCalled();
    expect(open.upsertCaption).not.toHaveBeenCalled();
    expect(open.upsertEmbedding).not.toHaveBeenCalled();
  });

  it("keeps v3 canary mutation exclusive to --canaries after the gate opens", async () => {
    const rows = new Map(
      v3CanaryPets.map(
        ({ slug }) => [slug, storedV3Caption(slug)] as const,
      ),
    );
    const input = v3Dependencies({
      options: {
        mode: "apply" as const,
        slug: null,
        force: true,
        canaries: false,
      },
      pets: [...v3CanaryPets, pet],
      createCaption: vi.fn(async () => v3BaseCaption),
      getCaption: vi.fn(async (_revision: string, slug: string) =>
        rows.get(slug) ?? null,
      ),
      getEmbeddingMetadata: vi.fn(async (_revision: string, slug: string) => {
        const row = rows.get(slug);
        return row
          ? {
              sourceHash: createPetVisualEmbeddingSourceHash({
                visualRevision: PET_VISUAL_MODEL_REVISION_V3,
                captionRevision: PET_VISION_CAPTION_REVISION_V3,
                captionSourceHash: row.sourceHash,
                captionText: row.captionText,
              }),
              dimensions: 256,
            }
          : null;
      }),
    });

    await expect(runPetVisionSearchBackfill(input)).resolves.toMatchObject({
      scanned: 1,
      captionAndVector: 1,
    });
    expect(input.createCaption).toHaveBeenCalledOnce();
    expect(input.embedDocument).toHaveBeenCalledOnce();
    expect(input.upsertCaption).toHaveBeenCalledOnce();
    expect(input.upsertEmbedding).toHaveBeenCalledOnce();
    expect(input.upsertCaption).toHaveBeenCalledWith(
      expect.objectContaining({ slug: pet.slug }),
    );
    expect(input.upsertEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ slug: pet.slug }),
    );
  });
});
