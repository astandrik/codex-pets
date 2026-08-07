import { describe, expect, it, vi } from "vitest";

import {
  embeddingToBuffer as runtimeEmbeddingToBuffer,
} from "../src/lib/pets/search-embeddings";
import {
  PET_SEARCH_EMBEDDING_MODELS,
  PET_VISION_CAPTION_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "../src/lib/pets/search-config";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText as buildRuntimeCaptionText,
  createPetVisionCaptionSourceHash as createRuntimeCaptionHash,
  createPetVisualEmbeddingSourceHash as createRuntimeVisualHash,
  parsePetVisionCaptionForRevision as parseRuntimeCaptionForRevision,
} from "../src/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY as RUNTIME_FRAME_POLICY,
  PET_VISION_FRAME_POLICY_V2 as RUNTIME_FRAME_POLICY_V2,
  extractPetVisionFrames as extractRuntimeFrames,
} from "../src/lib/pets/search-vision-frames";

const {
  PET_VISION_FRAME_POLICY,
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  embeddingToBuffer,
  extractPetVisionFrames,
  parsePetVisionCaptionForRevision,
  parseVisionBackfillArgs,
  runPetVisionSearchBackfill,
} = await import("./lib/pet-vision-search-backfill.mjs");
const {
  PET_VISION_BACKFILL_CAPTION_REVISIONS,
  PET_VISUAL_BACKFILL_REVISIONS,
} = await import("./lib/pet-search-provider-config.mjs");
const { RELATED_PETS_REBUILD_COMMANDS } = await import(
  "./lib/related-pets-maintenance.mjs"
);

const visualConfig = {
  captionRevision: PET_VISION_CAPTION_REVISION,
  visualRevision: PET_VISUAL_MODEL_REVISION,
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
const captionV2 = {
  ...caption,
  accessories: { en: "red scarf", ru: "красный шарф" },
  distinctive_features: { en: "round ears", ru: "круглые уши" },
  pose_motion: { en: "waves and jumps", ru: "машет и прыгает" },
};
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

describe("pet vision search backfill", () => {
  it("keeps Qwen visual provider definitions in runtime parity", () => {
    expect(PET_VISION_BACKFILL_CAPTION_REVISIONS).toEqual(
      PET_VISION_CAPTION_REVISIONS,
    );
    for (const [revision, definition] of Object.entries(
      PET_VISUAL_MODEL_REVISIONS,
    )) {
      const runtimeModel =
        PET_SEARCH_EMBEDDING_MODELS[definition.embeddingModelId];
      expect(PET_VISUAL_BACKFILL_REVISIONS[revision]).toEqual({
        captionRevision: definition.captionRevision,
        dimensions: runtimeModel.dimensions,
        documentModelPath: runtimeModel.documentModelPath,
        requestDimensions: runtimeModel.requestDimensions,
      });
    }
  });

  it("accepts only explicit supported modes and apply-only force", () => {
    expect(parseVisionBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
      continueOnError: false,
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
      continueOnError: false,
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
    expect(
      parseVisionBackfillArgs(["--apply", "--continue-on-error"]),
    ).toEqual({
      mode: "apply",
      slug: null,
      force: false,
      continueOnError: true,
    });
    expect(() =>
      parseVisionBackfillArgs([
        "--apply",
        "--slug=velvet-byte",
        "--continue-on-error",
      ]),
    ).toThrow(/full.*apply/i);
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

  it("keeps the V2 frame, caption, text, and hash contracts in runtime parity", () => {
    const scriptCaption = parsePetVisionCaptionForRevision(
      captionV2,
      PET_VISION_CAPTION_REVISION_V2,
    );
    const runtimeCaption = parseRuntimeCaptionForRevision(
      captionV2,
      PET_VISION_CAPTION_REVISION_V2,
    );
    expect(scriptCaption).toEqual(runtimeCaption);
    expect(RUNTIME_FRAME_POLICY_V2).toMatchObject({
      id: "pet-vision-nine-central-frames-v2",
      frames: expect.arrayContaining([
        expect.objectContaining({ state: "running-left", row: 2 }),
        expect.objectContaining({ state: "review", row: 8 }),
      ]),
    });
    expect(buildPetVisionCaptionText(scriptCaption)).toBe(
      buildRuntimeCaptionText(runtimeCaption),
    );
    const hashInput = {
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      modelUri: visualConfig.modelUri,
      assetId: "asset-v2",
      spritesheetSha256,
    };
    expect(createPetVisionCaptionSourceHash(hashInput)).toBe(
      createRuntimeCaptionHash(hashInput),
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
      failed: 0,
      failedSlugs: [],
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
    expect(vectorInput.log).toHaveBeenLastCalledWith({
      action: "related-pets-rebuild-required",
      commands: RELATED_PETS_REBUILD_COMMANDS,
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
    expect(firstRun.log).toHaveBeenLastCalledWith({
      action: "related-pets-rebuild-required",
      commands: RELATED_PETS_REBUILD_COMMANDS,
    });

    const resumed = dependencies({
      getCaption: vi.fn(async () => freshCaption()),
    });
    const summary = await runPetVisionSearchBackfill(resumed);
    expect(summary.vectorOnly).toBe(1);
    expect(resumed.createCaption).not.toHaveBeenCalled();
  });

  it("emits the related snapshot follow-up when a later pet fails", async () => {
    const logs: unknown[] = [];
    let spritesheetRead = 0;
    const input = dependencies({
      pets: [
        pet,
        {
          ...pet,
          slug: "nightshade",
          spritesheetUrl: "/api/assets/asset-nightshade/spritesheet.webp",
        },
      ],
      readSpritesheet: vi.fn(async () => {
        spritesheetRead += 1;
        if (spritesheetRead === 2) {
          throw new Error("asset unavailable");
        }
        return Buffer.from("atlas");
      }),
      log: (entry: unknown) => logs.push(entry),
    });

    await expect(runPetVisionSearchBackfill(input)).rejects.toMatchObject({
      reason: "asset_error",
    });

    expect(logs.at(-1)).toEqual({
      action: "related-pets-rebuild-required",
      commands: RELATED_PETS_REBUILD_COMMANDS,
    });
  });

  it("continues a full apply run, reports every failed slug, and exits nonzero", async () => {
    const logs: unknown[] = [];
    const input = dependencies({
      options: {
        mode: "apply",
        slug: null,
        force: false,
        continueOnError: true,
      },
      pets: [
        pet,
        {
          ...pet,
          slug: "nightshade",
          spritesheetUrl: "/api/assets/asset-nightshade/spritesheet.webp",
        },
        {
          ...pet,
          slug: "sunny-byte",
          spritesheetUrl: "/api/assets/asset-sunny/spritesheet.webp",
        },
      ],
      readSpritesheet: vi.fn(async (assetId: string) => {
        if (assetId === "asset-nightshade") {
          throw new Error("private asset failure");
        }
        return Buffer.from("atlas");
      }),
      log: (entry: unknown) => logs.push(entry),
    });

    await expect(runPetVisionSearchBackfill(input)).rejects.toMatchObject({
      reason: "partial_failure",
    });
    expect(input.readSpritesheet).toHaveBeenCalledTimes(3);
    expect(logs).toContainEqual({
      action: "summary",
      scanned: 3,
      unchanged: 0,
      vectorOnly: 0,
      captionAndVector: 2,
      failed: 1,
      failedSlugs: ["nightshade"],
    });
    expect(JSON.stringify(logs)).not.toContain("private asset failure");
  });
});
