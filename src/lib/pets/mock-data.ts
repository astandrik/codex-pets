import { assetUrl } from "@/lib/pets/asset-urls";
import { statusAfterModeration } from "@/lib/pets/moderation";
import type { ApprovalStatus, PetKind } from "@/lib/pets/types";

export type MockPetMetrics = {
  downloadCount: number;
  installCount: number;
  likeCount: number;
};

export type MockPetRecord = {
  assetId: string;
  slug: string;
  id: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  petJsonUrl: string;
  zipUrl: string;
  spritesheetExt: "webp" | "png";
  kind: PetKind;
  tags: string[];
  status: ApprovalStatus;
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  contactEmail: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  metrics: MockPetMetrics;
  color: string;
  accent: string;
  glyph: string;
};

type CreateMockPetRecordInput = {
  requestedSlug: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  petJsonUrl: string;
  zipUrl: string;
  spritesheetExt: "webp" | "png";
  kind: PetKind;
  tags: string[];
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  contactEmail: string | null;
};

type MockPetSeed = {
  assetId: string;
  slug: string;
  id: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
  status: ApprovalStatus;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  color: string;
  accent: string;
  glyph: string;
  metrics: MockPetMetrics;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
};

const MOCK_PET_SEEDS: MockPetSeed[] = [
  {
    slug: "orbit-otter",
    id: "dev_pet_orbit_otter",
    assetId: "dev_asset_orbit_otter",
    displayName: "Orbit Otter",
    description:
      "A compact space helper with calm idle loops and bright review states.",
    kind: "creature",
    tags: ["space", "friendly", "blue"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#4da3ff",
    accent: "#f8d65b",
    glyph: "OO",
    metrics: { downloadCount: 37, installCount: 18, likeCount: 12 },
    createdAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-04T10:00:00.000Z",
    approvedAt: "2026-05-04T10:00:00.000Z",
  },
  {
    slug: "terminal-cube",
    id: "dev_pet_terminal_cube",
    assetId: "dev_asset_terminal_cube",
    displayName: "Terminal Cube",
    description:
      "A geometric object pet for dense coding sessions and quick status changes.",
    kind: "object",
    tags: ["terminal", "object", "green"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#55c271",
    accent: "#151617",
    glyph: "TC",
    metrics: { downloadCount: 22, installCount: 11, likeCount: 9 },
    createdAt: "2026-05-05T10:00:00.000Z",
    updatedAt: "2026-05-06T10:00:00.000Z",
    approvedAt: "2026-05-06T10:00:00.000Z",
  },
  {
    slug: "patch-pilot",
    id: "dev_pet_patch_pilot",
    assetId: "dev_asset_patch_pilot",
    displayName: "Patch Pilot",
    description:
      "A character pet that looks at home around diffs, reviews, and small releases.",
    kind: "character",
    tags: ["review", "pilot", "amber"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#f59f45",
    accent: "#2f5d62",
    glyph: "PP",
    metrics: { downloadCount: 14, installCount: 8, likeCount: 6 },
    createdAt: "2026-05-07T10:00:00.000Z",
    updatedAt: "2026-05-08T10:00:00.000Z",
    approvedAt: "2026-05-08T10:00:00.000Z",
  },
  {
    slug: "byte-beacon",
    id: "dev_pet_byte_beacon",
    assetId: "dev_asset_byte_beacon",
    displayName: "Byte Beacon",
    description:
      "A signal-focused object pet with crisp idle pulses and high-contrast states.",
    kind: "object",
    tags: ["signal", "bright", "cyan"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#33d6c4",
    accent: "#12263a",
    glyph: "BB",
    metrics: { downloadCount: 64, installCount: 31, likeCount: 26 },
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-09T10:00:00.000Z",
    approvedAt: "2026-05-09T10:00:00.000Z",
  },
  {
    slug: "cache-courier",
    id: "dev_pet_cache_courier",
    assetId: "dev_asset_cache_courier",
    displayName: "Cache Courier",
    description:
      "A quick character pet for build loops, cache hits, and quiet waiting states.",
    kind: "character",
    tags: ["build", "cache", "violet"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#8d6df2",
    accent: "#f4e7ff",
    glyph: "CC",
    metrics: { downloadCount: 49, installCount: 20, likeCount: 17 },
    createdAt: "2026-05-08T14:00:00.000Z",
    updatedAt: "2026-05-09T11:00:00.000Z",
    approvedAt: "2026-05-09T11:00:00.000Z",
  },
  {
    slug: "merge-mender",
    id: "dev_pet_merge_mender",
    assetId: "dev_asset_merge_mender",
    displayName: "Merge Mender",
    description:
      "A patient helper for conflict-heavy sessions and careful review passes.",
    kind: "character",
    tags: ["merge", "review", "teal"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#2bb3a3",
    accent: "#ffd166",
    glyph: "MM",
    metrics: { downloadCount: 58, installCount: 27, likeCount: 22 },
    createdAt: "2026-05-08T16:00:00.000Z",
    updatedAt: "2026-05-09T12:00:00.000Z",
    approvedAt: "2026-05-09T12:00:00.000Z",
  },
  {
    slug: "slate-sprite",
    id: "dev_pet_slate_sprite",
    assetId: "dev_asset_slate_sprite",
    displayName: "Slate Sprite",
    description:
      "A small creature pet with muted colors, soft motion, and readable states.",
    kind: "creature",
    tags: ["sprite", "calm", "slate"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#7e8fa3",
    accent: "#d6fff6",
    glyph: "SS",
    metrics: { downloadCount: 33, installCount: 16, likeCount: 13 },
    createdAt: "2026-05-08T18:00:00.000Z",
    updatedAt: "2026-05-09T13:00:00.000Z",
    approvedAt: "2026-05-09T13:00:00.000Z",
  },
  {
    slug: "neon-nibble",
    id: "dev_pet_neon_nibble",
    assetId: "dev_asset_neon_nibble",
    displayName: "Neon Nibble",
    description:
      "A playful creature pet tuned for fast animation previews and compact cards.",
    kind: "creature",
    tags: ["neon", "playful", "pink"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#ff5ea8",
    accent: "#fff36d",
    glyph: "NN",
    metrics: { downloadCount: 71, installCount: 38, likeCount: 34 },
    createdAt: "2026-05-09T09:00:00.000Z",
    updatedAt: "2026-05-10T09:00:00.000Z",
    approvedAt: "2026-05-10T09:00:00.000Z",
  },
  {
    slug: "review-rover",
    id: "dev_pet_review_rover",
    assetId: "dev_asset_review_rover",
    displayName: "Review Rover",
    description:
      "A steady character pet for pull request checks and final polish passes.",
    kind: "character",
    tags: ["review", "checks", "indigo"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#5f6cff",
    accent: "#f2f7ff",
    glyph: "RR",
    metrics: { downloadCount: 45, installCount: 24, likeCount: 19 },
    createdAt: "2026-05-09T10:00:00.000Z",
    updatedAt: "2026-05-10T10:00:00.000Z",
    approvedAt: "2026-05-10T10:00:00.000Z",
  },
  {
    slug: "prism-pod",
    id: "dev_pet_prism_pod",
    assetId: "dev_asset_prism_pod",
    displayName: "Prism Pod",
    description:
      "A rounded object pet with colorful state changes and simple silhouettes.",
    kind: "object",
    tags: ["prism", "object", "rainbow"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#3ab7ff",
    accent: "#ffcf33",
    glyph: "PD",
    metrics: { downloadCount: 29, installCount: 15, likeCount: 11 },
    createdAt: "2026-05-09T11:00:00.000Z",
    updatedAt: "2026-05-10T11:00:00.000Z",
    approvedAt: "2026-05-10T11:00:00.000Z",
  },
  {
    slug: "stack-sentinel",
    id: "dev_pet_stack_sentinel",
    assetId: "dev_asset_stack_sentinel",
    displayName: "Stack Sentinel",
    description:
      "A watchful character pet for long-running jobs, logs, and queue states.",
    kind: "character",
    tags: ["stack", "logs", "orange"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#f07d3c",
    accent: "#1f2933",
    glyph: "ST",
    metrics: { downloadCount: 52, installCount: 22, likeCount: 18 },
    createdAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    approvedAt: "2026-05-10T12:00:00.000Z",
  },
  {
    slug: "token-torch",
    id: "dev_pet_token_torch",
    assetId: "dev_asset_token_torch",
    displayName: "Token Torch",
    description:
      "A bright object pet designed around readable progress and review states.",
    kind: "object",
    tags: ["token", "progress", "gold"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#ffb000",
    accent: "#273043",
    glyph: "TT",
    metrics: { downloadCount: 41, installCount: 18, likeCount: 15 },
    createdAt: "2026-05-09T13:00:00.000Z",
    updatedAt: "2026-05-10T13:00:00.000Z",
    approvedAt: "2026-05-10T13:00:00.000Z",
  },
  {
    slug: "runtime-rider",
    id: "dev_pet_runtime_rider",
    assetId: "dev_asset_runtime_rider",
    displayName: "Runtime Rider",
    description:
      "A mobile character pet for active work states, restarts, and deploy checks.",
    kind: "character",
    tags: ["runtime", "deploy", "blue"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#2d8cff",
    accent: "#ffffff",
    glyph: "RT",
    metrics: { downloadCount: 68, installCount: 33, likeCount: 29 },
    createdAt: "2026-05-09T14:00:00.000Z",
    updatedAt: "2026-05-10T14:00:00.000Z",
    approvedAt: "2026-05-10T14:00:00.000Z",
  },
  {
    slug: "prompt-pulse",
    id: "dev_pet_prompt_pulse",
    assetId: "dev_asset_prompt_pulse",
    displayName: "Prompt Pulse",
    description:
      "A compact object pet with rhythmic idle motion and sharp waiting states.",
    kind: "object",
    tags: ["prompt", "waiting", "red"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#e84a5f",
    accent: "#fbeec1",
    glyph: "PT",
    metrics: { downloadCount: 36, installCount: 17, likeCount: 14 },
    createdAt: "2026-05-09T15:00:00.000Z",
    updatedAt: "2026-05-10T15:00:00.000Z",
    approvedAt: "2026-05-10T15:00:00.000Z",
  },
  {
    slug: "vector-vault",
    id: "dev_pet_vector_vault",
    assetId: "dev_asset_vector_vault",
    displayName: "Vector Vault",
    description:
      "A sturdy object pet for embeddings, search sessions, and saved context.",
    kind: "object",
    tags: ["vector", "search", "green"],
    status: "approved",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#3fb950",
    accent: "#0d1117",
    glyph: "VV",
    metrics: { downloadCount: 57, installCount: 25, likeCount: 21 },
    createdAt: "2026-05-09T16:00:00.000Z",
    updatedAt: "2026-05-10T16:00:00.000Z",
    approvedAt: "2026-05-10T16:00:00.000Z",
  },
  {
    slug: "pending-pixel",
    id: "dev_pet_pending_pixel",
    assetId: "dev_asset_pending_pixel",
    displayName: "Pending Pixel",
    description:
      "A sample pending submission for exercising the moderation queue.",
    kind: "object",
    tags: ["pending", "moderation", "sample"],
    status: "pending",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#b06ee8",
    accent: "#f5f5f5",
    glyph: "PX",
    metrics: { downloadCount: 0, installCount: 0, likeCount: 0 },
    createdAt: "2026-05-10T10:00:00.000Z",
    updatedAt: "2026-05-10T10:00:00.000Z",
  },
  {
    slug: "rejected-spark",
    id: "dev_pet_rejected_spark",
    assetId: "dev_asset_rejected_spark",
    displayName: "Rejected Spark",
    description: "A sample rejected submission with a stored review reason.",
    kind: "creature",
    tags: ["rejected", "sample"],
    status: "rejected",
    ownerId: "local-admin",
    ownerEmail: "local-admin@example.com",
    ownerName: "Local Admin",
    color: "#ee5d5d",
    accent: "#2b2f36",
    glyph: "RS",
    metrics: { downloadCount: 0, installCount: 0, likeCount: 0 },
    rejectionReason: "Demo rejection reason for local moderation testing.",
    createdAt: "2026-05-09T10:00:00.000Z",
    updatedAt: "2026-05-10T10:00:00.000Z",
    rejectedAt: "2026-05-10T10:00:00.000Z",
  },
];

const INITIAL_MOCK_PET_RECORDS: MockPetRecord[] = MOCK_PET_SEEDS.map((seed) => ({
  ...seed,
  spritesheetUrl: assetUrl(seed.assetId, "spritesheet.png"),
  petJsonUrl: assetUrl(seed.assetId, "pet.json"),
  zipUrl: assetUrl(seed.assetId, "pet.zip"),
  spritesheetExt: "png",
  contactEmail: seed.ownerEmail,
  rejectionReason: seed.rejectionReason ?? null,
  approvedAt: seed.approvedAt ?? null,
  rejectedAt: seed.rejectedAt ?? null,
}));

const mockPetsBySlug = new Map<string, MockPetRecord>();
const mockPetsById = new Map<string, MockPetRecord>();

for (const pet of INITIAL_MOCK_PET_RECORDS) {
  writeMockPet(pet);
}

export function isMockPetsDataSource(): boolean {
  return process.env.CODEX_PETS_DATA_SOURCE?.trim() === "mock";
}

export function listMockPetRecords(): MockPetRecord[] {
  return Array.from(mockPetsBySlug.values());
}

export function getMockPetBySlug(slug: string): MockPetRecord | null {
  return mockPetsBySlug.get(slug) ?? null;
}

export function getMockPetById(id: string): MockPetRecord | null {
  return mockPetsById.get(id) ?? null;
}

export function getMockPetByAssetId(assetId: string): MockPetRecord | null {
  return listMockPetRecords().find((pet) => pet.assetId === assetId) ?? null;
}

export function createMockPetRecord(
  input: CreateMockPetRecordInput,
): MockPetRecord {
  const now = new Date().toISOString();
  const slug = resolveUniqueMockSlug(input.requestedSlug);
  const pet: MockPetRecord = {
    slug,
    id: `mock_${slug}`,
    assetId: assetIdFromUrl(input.spritesheetUrl) ?? `mock_asset_${slug}`,
    displayName: input.displayName,
    description: input.description,
    spritesheetUrl: input.spritesheetUrl,
    petJsonUrl: input.petJsonUrl,
    zipUrl: input.zipUrl,
    spritesheetExt: input.spritesheetExt,
    kind: input.kind,
    tags: input.tags,
    status: "pending",
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    contactEmail: input.contactEmail,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    rejectedAt: null,
    metrics: { downloadCount: 0, installCount: 0, likeCount: 0 },
    color: "#4da3ff",
    accent: "#f8d65b",
    glyph: slug.slice(0, 2).toUpperCase() || "CP",
  };

  writeMockPet(pet);
  return pet;
}

export function moderateMockPet(input: {
  petId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): MockPetRecord | null {
  const pet = getMockPetById(input.petId);
  if (!pet) return null;

  const now = new Date().toISOString();
  const nextStatus = statusAfterModeration(pet.status, input.decision);
  const updatedPet: MockPetRecord = {
    ...pet,
    status: nextStatus,
    updatedAt: now,
    approvedAt: nextStatus === "approved" ? now : pet.approvedAt,
    rejectedAt: nextStatus === "rejected" ? now : null,
    rejectionReason:
      nextStatus === "rejected" ? input.reason?.trim() ?? "" : null,
  };

  writeMockPet(updatedPet);
  return updatedPet;
}

export function softDeleteMockPetById(input: {
  petId: string;
  actorUserId: string;
  actorRole: "user" | "admin";
}): boolean {
  const pet = getMockPetById(input.petId);
  if (
    !pet ||
    pet.status === "deleted" ||
    (input.actorRole !== "admin" && pet.ownerId !== input.actorUserId)
  ) {
    return false;
  }

  writeMockPet({
    ...pet,
    status: "deleted",
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export function incrementMockDownload(slug: string): void {
  const pet = getMockPetBySlug(slug);
  if (!pet) return;

  writeMockPet({
    ...pet,
    metrics: {
      ...pet.metrics,
      downloadCount: pet.metrics.downloadCount + 1,
    },
    updatedAt: new Date().toISOString(),
  });
}

export function incrementMockInstall(slug: string): void {
  const pet = getMockPetBySlug(slug);
  if (!pet) return;

  writeMockPet({
    ...pet,
    metrics: {
      ...pet.metrics,
      installCount: pet.metrics.installCount + 1,
    },
    updatedAt: new Date().toISOString(),
  });
}

export function incrementMockLike(slug: string): number {
  const pet = getMockPetBySlug(slug);
  if (!pet) return 0;

  const likeCount = pet.metrics.likeCount + 1;
  writeMockPet({
    ...pet,
    metrics: {
      ...pet.metrics,
      likeCount,
    },
    updatedAt: new Date().toISOString(),
  });
  return likeCount;
}

function writeMockPet(pet: MockPetRecord): void {
  mockPetsBySlug.set(pet.slug, pet);
  mockPetsById.set(pet.id, pet);
}

function resolveUniqueMockSlug(base: string): string {
  if (!mockPetsBySlug.has(base)) return base;

  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 48);
    if (!mockPetsBySlug.has(candidate)) return candidate;
  }

  return `${base.slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;
}

function assetIdFromUrl(value: string): string | null {
  const match = value.match(/\/api\/assets\/([^/]+)\//);
  return match?.[1] ?? null;
}
