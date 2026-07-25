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
  PET_DERIVED_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION,
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText as buildRuntimeCaptionText,
  createPetDerivedVisionCaptionEnvelope as createRuntimeDerivedEnvelope,
  createPetDerivedVisionCaptionSourceHash as createRuntimeDerivedHash,
  createPetVisionCaptionTextHash as createRuntimeCaptionTextHash,
  createPetVisionCaptionSourceHash as createRuntimeCaptionHash,
  createPetVisualEmbeddingSourceHash as createRuntimeVisualHash,
} from "../src/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY as RUNTIME_FRAME_POLICY,
  extractPetVisionFrames as extractRuntimeFrames,
} from "../src/lib/pets/search-vision-frames";

const {
  PET_VISION_FRAME_POLICY,
  buildPetVisionCaptionText,
  createPetDerivedVisionCaptionEnvelope,
  createPetDerivedVisionCaptionSourceHash,
  createPetVisionCaptionTextHash,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  embeddingToBuffer,
  extractPetVisionFrames,
  parseVisionBackfillArgs,
  runPetVisionSearchBackfill,
} = await import("./lib/pet-vision-search-backfill.mjs");
const {
  PET_VISION_BACKFILL_CAPTION_REVISIONS,
  PET_VISUAL_BACKFILL_REVISIONS,
} = await import("./lib/pet-search-provider-config.mjs");

const visualConfig = {
  captionRevision: PET_VISION_CAPTION_REVISION,
  visualRevision: PET_VISUAL_MODEL_REVISION,
  dimensions: 256,
  modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
};
const derivedVisualConfig = {
  captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
  visualRevision:
    "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-deepseek-v4-v1",
  dimensions: 768,
  modelUri: "gpt://folder-1/deepseek-v4-flash",
  captionDefinition: {
    kind: "rewrite",
    upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
    upstreamModelUri: "gpt://folder-1/qwen3.6-35b-a3b",
  },
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
    rewriteCaption: vi.fn(async () => caption),
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
  it("keeps managed caption and visual provider definitions in runtime parity", () => {
    expect(PET_VISION_BACKFILL_CAPTION_REVISIONS).toEqual(
      PET_VISION_CAPTION_REVISIONS,
    );
    for (const [revision, definition] of Object.entries(
      PET_VISUAL_MODEL_REVISIONS,
    )) {
      const model =
        PET_SEARCH_EMBEDDING_MODELS[definition.embeddingModelId];
      expect(PET_VISUAL_BACKFILL_REVISIONS[revision]).toEqual({
        captionRevision: definition.captionRevision,
        dimensions: model.dimensions,
        documentModelPath: model.documentModelPath,
        requestDimensions: model.requestDimensions,
      });
    }
  });

  it("accepts only explicit supported modes and apply-only force", () => {
    expect(parseVisionBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
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

  it("keeps derived provenance and hash construction in runtime parity", () => {
    const upstreamCaptionText = buildPetVisionCaptionText(caption);
    const input = {
      captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
      modelUri: "gpt://folder-1/deepseek-v4-flash",
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: "a".repeat(64),
      upstreamCaptionText,
    };
    expect(createPetDerivedVisionCaptionSourceHash(input)).toBe(
      createRuntimeDerivedHash(input),
    );
    expect(createPetVisionCaptionTextHash(upstreamCaptionText)).toBe(
      createRuntimeCaptionTextHash(upstreamCaptionText),
    );
    const envelopeInput = {
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: "a".repeat(64),
      upstreamCaptionTextSha256:
        createPetVisionCaptionTextHash(upstreamCaptionText),
      caption,
    };
    expect(createPetDerivedVisionCaptionEnvelope(envelopeInput)).toEqual(
      createRuntimeDerivedEnvelope(envelopeInput),
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

  it("derives from a fresh Qwen row and writes additive 768 artifacts", async () => {
    const upstream = freshCaption();
    const rewritten = {
      ...caption,
      search_terms_en: ["silver-haired woman", "gothic", "pixel art"],
    };
    const input = dependencies({
      config: derivedVisualConfig,
      getCaption: vi.fn(async (revision: string) =>
        revision === PET_VISION_CAPTION_REVISION ? upstream : null
      ),
      rewriteCaption: vi.fn(async () => rewritten),
      embedDocument: vi.fn(async () => Array(768).fill(0.5)),
    });

    const summary = await runPetVisionSearchBackfill(input);

    expect(summary.captionAndVector).toBe(1);
    expect(input.createCaption).not.toHaveBeenCalled();
    expect(input.rewriteCaption).toHaveBeenCalledWith(caption);
    const derivedSourceHash = createPetDerivedVisionCaptionSourceHash({
      captionRevision: derivedVisualConfig.captionRevision,
      modelUri: derivedVisualConfig.modelUri,
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: upstream.sourceHash,
      upstreamCaptionText: upstream.captionText,
    });
    expect(input.upsertCaption).toHaveBeenCalledWith({
      captionRevision: derivedVisualConfig.captionRevision,
      slug: pet.slug,
      sourceHash: derivedSourceHash,
      captionJson: JSON.stringify(
        createPetDerivedVisionCaptionEnvelope({
          upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
          upstreamSourceHash: upstream.sourceHash,
          upstreamCaptionTextSha256:
            createPetVisionCaptionTextHash(upstream.captionText),
          caption: rewritten,
        }),
      ),
      captionText: buildPetVisionCaptionText(rewritten),
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    expect(input.upsertEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: derivedVisualConfig.visualRevision,
        dimensions: 768,
        embedding: Array(768).fill(0.5),
      }),
    );
  });

  it("materializes the missing Qwen row before calling the rewriter", async () => {
    const writes: string[] = [];
    const input = dependencies({
      config: derivedVisualConfig,
      embedDocument: vi.fn(async () => Array(768).fill(0.5)),
      upsertCaption: vi.fn(async (value: { captionRevision: string }) => {
        writes.push(value.captionRevision);
      }),
    });

    await runPetVisionSearchBackfill(input);

    expect(writes).toEqual([
      PET_VISION_CAPTION_REVISION,
      PET_DERIVED_VISION_CAPTION_REVISION,
    ]);
    expect(input.createCaption).toHaveBeenCalledOnce();
    expect(input.rewriteCaption).toHaveBeenCalledOnce();
  });
});
