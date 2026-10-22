import {createHash, randomUUID} from "node:crypto";
import sharp from "sharp";
import {PET_STATES, PET_LOOK_DIRECTIONS} from "@/lib/pets/types";
import {createGenerationService} from "./service";
import {buildGeneratedPackage} from "./package";
import {MemoryStore} from "./test-store";
import {DAY, type GenerationJob} from "./model";

export async function revisionFixture() {
  const config = {now: Date.parse("2026-10-21T10:00:00Z"), enabled: true};
  const store = new MemoryStore();
  const service = createGenerationService(store, {now: () => config.now, enabled: () => config.enabled, secret: () => "synthetic-animation-revisions-secret"});
  const base = await sharp({create: {width: 32, height: 32, channels: 4, background: "#ffbf00"}}).png().toBuffer();
  const width = 1536, height = 2288, pixels = Buffer.alloc(width * height * 4);
  const cells = [...PET_STATES.flatMap(s => Array.from({length: s.frames}, (_, col) => ({row: s.row, col}))), ...PET_LOOK_DIRECTIONS.map(c => ({row: c.row, col: c.column}))];
  for (const {row, col} of cells) for (let y = 70; y < 120; y++) for (let x = 70; x < 120; x++) {
    const i = ((row * 208 + y) * width + col * 192 + x) * 4;
    pixels.set([20 + row * 20, 60, 100 + col * 10, 255], i);
  }
  const atlas = await sharp(pixels, {raw: {width, height, channels: 4}}).png().toBuffer();
  const source: GenerationJob = {id: "a".repeat(64), prompt: "", displayName: "Orb", status: "completed", createdAt: config.now, expiresAt: config.now + DAY, worker: "", promptRevision: "test", pipelineVersion: 2, reviewBase: true, baseConfirmedAt: config.now, animationPrompt: "Move gently", stages: [{name: "base", status: "completed", sha256: createHash("sha256").update(base).digest("hex"), startedAt: config.now}], cardMetadata: {policy: 1, state: "completed", revision: 2, edited: true, fields: {displayName: "Orb", description: "Floating character", tags: ["orb"]}}};
  const files = await buildGeneratedPackage(source, atlas);
  await store.transaction(async tx => {
    await tx.putJob(source);
    for (const [kind, bytes] of Object.entries({...files, "stage-base.png": base})) await tx.putArtifact(source.id, kind, bytes, source.expiresAt);
  });
  const input = () => ({requestId: randomUUID(), states: ["idle", "waving"], prompt: "Tilt without adding arms", sourceMetadataRevision: 2});
  return {config, store, service, source, files, base, atlas, input};
}
