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
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText as buildRuntimeCaptionText,
  createPetVisionCaptionSourceHash as createRuntimeCaptionHash,
  createPetVisualEmbeddingSourceHash as createRuntimeVisualHash,
} from "../src/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY as RUNTIME_FRAME_POLICY,
  extractPetVisionFrames as extractRuntimeFrames,
} from "../src/lib/pets/search-vision-frames";

const {
  PET_VISION_FRAME_POLICY,
  PET_VISION_RESPONSE_JSON_SCHEMA,
  PET_VISION_SYSTEM_PROMPT,
  PET_VISION_USER_PROMPT,
  buildPetVisionCaptionText,
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
const { RELATED_PETS_REBUILD_COMMANDS } = await import(
  "./lib/related-pets-maintenance.mjs"
);
const { createVisionProvider } = await import(
  "./backfill-pet-vision-search.mjs"
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
  it("uses the same four-frame Responses contract in the maintenance CLI", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const diagnostics: unknown[] = [];
    const provider = createVisionProvider(
      {
        folderId: "folder-1",
        apiKey: "SECRET_API_KEY",
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        visionTimeoutMs: 180_000,
      },
      {
        fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
          requests.push({ url: String(url), init });
          return completedVisionResponse(caption);
        },
        randomUUID: () => "00000000-0000-4000-8000-000000000001",
        sleep: async () => undefined,
        onDiagnostic: (entry: unknown) => diagnostics.push(entry),
      },
    );

    await expect(provider(frames)).resolves.toEqual(caption);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://ai.api.cloud.yandex.net/v1/responses",
    );
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt://folder-1/qwen3.6-35b-a3b",
      instructions: PET_VISION_SYSTEM_PROMPT,
      max_output_tokens: 8_000,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "pet_visual_caption_v1",
          strict: true,
          schema: PET_VISION_RESPONSE_JSON_SCHEMA,
        },
      },
    });
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: PET_VISION_USER_PROMPT },
      ...frames.map((frame) => ({
        type: "input_image",
        image_url: frame.dataUrl,
      })),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET_API_KEY");
    expect(JSON.stringify(diagnostics)).not.toContain(frames[0]?.dataUrl);
    expect(JSON.stringify(diagnostics)).not.toContain("silver hair");
  });

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
});

function completedVisionResponse(value: typeof caption): Response {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(value),
          },
        ],
      },
    ],
  });
}
