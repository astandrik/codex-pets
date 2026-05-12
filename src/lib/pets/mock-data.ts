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
