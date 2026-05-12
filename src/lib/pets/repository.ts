import { TABLES } from "@/lib/ydb/schema";
import { TypedValues, withSession, isYdbConfigured } from "@/lib/ydb/client";
import { rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import type { ApprovalStatus, PetKind, PublicPet } from "@/lib/pets/types";
import { withBasePath } from "@/lib/base-path";
import { slugify, type PetJson } from "@/lib/pets/validation";
import { statusAfterModeration } from "@/lib/pets/moderation";
import {
  createMockPetRecord,
  getMockPetById,
  getMockPetBySlug,
  incrementMockDownload,
  incrementMockLike,
  isMockPetsDataSource,
  listMockPetRecords,
  moderateMockPet,
  softDeleteMockPetById,
} from "@/lib/pets/mock-data";

export type PublicPetMetrics = {
  downloadCount: number;
  likeCount: number;
};

type PetMetrics = PublicPetMetrics & {
  installCount: number;
};

const EMPTY_METRICS: PetMetrics = {
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

type PetRow = {
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
};

export type CreatePendingPetInput = {
  petJson: PetJson;
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  contactEmail: string | null;
  kind: PetKind;
  tags: string[];
  zipUrl: string;
  petJsonUrl: string;
  spritesheetUrl: string;
  spritesheetExt: "webp" | "png";
};

export type PetFilters = {
  q?: string;
  kind?: PetKind | "all";
};

export async function listApprovedPets(
  filters: PetFilters = {},
): Promise<PublicPet[]> {
  if (isMockPetsDataSource()) {
    return listMockPets(filters, "approved");
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE status = $status
ORDER BY created_at DESC
LIMIT 200;
      `,
      { $status: TypedValues.utf8("approved") },
    ),
  );

  const q = filters.q?.trim().toLowerCase();
  const rows = rowsFromResult(result)
    .map(parsePetRow)
    .filter((pet) => {
      if (filters.kind && filters.kind !== "all" && pet.kind !== filters.kind) {
        return false;
      }
      if (!q) return true;
      return (
        pet.displayName.toLowerCase().includes(q) ||
        pet.description.toLowerCase().includes(q) ||
        pet.tags.some((tag) => tag.includes(q))
      );
    });
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));

  return rows.map((row) =>
    toPublicPet(row, metricsBySlug.get(row.slug) ?? EMPTY_METRICS),
  );
}

export async function getApprovedPetBySlug(
  slug: string,
): Promise<PublicPet | null> {
  if (isMockPetsDataSource()) {
    const pet = getMockPetBySlug(slug);
    if (!pet || pet.status !== "approved") return null;
    return toPublicPet(pet, pet.metrics);
  }

  const pet = await getPetBySlug(slug);
  if (!pet || pet.status !== "approved") return null;
  const metrics = await getMetrics(slug);
  return toPublicPet(pet, metrics);
}

export async function getPetBySlug(slug: string): Promise<PetRow | null> {
  if (isMockPetsDataSource()) {
    return getMockPetBySlug(slug);
  }

  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $slug AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE slug = $slug
LIMIT 1;
      `,
      { $slug: TypedValues.utf8(slug) },
    ),
  );

  return rowsFromResult(result).map(parsePetRow)[0] ?? null;
}

export async function listPetsForOwner(ownerId: string): Promise<PublicPet[]> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords().filter(
      (pet) => pet.ownerId === ownerId && pet.status !== "deleted",
    ).map((pet) => toPublicPet(pet, pet.metrics));
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $owner_id AS Utf8;
DECLARE $deleted_status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE owner_id = $owner_id AND status != $deleted_status
ORDER BY created_at DESC
LIMIT 200;
      `,
      {
        $owner_id: TypedValues.utf8(ownerId),
        $deleted_status: TypedValues.utf8("deleted"),
      },
    ),
  );

  const rows = rowsFromResult(result).map(parsePetRow);
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));

  return rows.map((row) =>
    toPublicPet(row, metricsBySlug.get(row.slug) ?? EMPTY_METRICS),
  );
}

export async function listPendingPets(): Promise<PublicPet[]> {
  if (isMockPetsDataSource()) {
    return listMockPets({}, "pending");
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE status = $status
ORDER BY created_at ASC
LIMIT 200;
      `,
      { $status: TypedValues.utf8("pending") },
    ),
  );

  const rows = rowsFromResult(result).map(parsePetRow);
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));

  return rows.map((row) =>
    toPublicPet(row, metricsBySlug.get(row.slug) ?? EMPTY_METRICS),
  );
}

export async function countPendingPets(): Promise<number> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords().filter((pet) => pet.status === "pending").length;
  }

  if (!isYdbConfigured()) return 0;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT COUNT(*) AS pending_count
FROM ${TABLES.pets}
WHERE status = $status;
      `,
      { $status: TypedValues.utf8("pending") },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? uintAt(row, 0) : 0;
}

export async function createPendingPet(
  input: CreatePendingPetInput,
): Promise<PublicPet> {
  if (isMockPetsDataSource()) {
    const slug = slugify(input.petJson.id || input.petJson.displayName);
    if (!slug) {
      throw new Error("Pet id cannot be converted into a public slug.");
    }

    const pet = createMockPetRecord({
      requestedSlug: slug,
      displayName: input.petJson.displayName,
      description: input.petJson.description,
      spritesheetUrl: input.spritesheetUrl,
      petJsonUrl: input.petJsonUrl,
      zipUrl: input.zipUrl,
      spritesheetExt: input.spritesheetExt,
      kind: input.kind,
      tags: input.tags,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail,
      ownerName: input.ownerName,
      contactEmail: input.contactEmail,
    });

    return toPublicPet(pet, pet.metrics);
  }

  const requestedSlug = slugify(input.petJson.id || input.petJson.displayName);
  if (!requestedSlug) {
    throw new Error("Pet id cannot be converted into a public slug.");
  }

  const slug = await resolveUniqueSlug(requestedSlug);
  const now = new Date().toISOString();
  const id = `pet_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`;

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $slug AS Utf8;
DECLARE $id AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $description AS Utf8;
DECLARE $spritesheet_url AS Utf8;
DECLARE $pet_json_url AS Utf8;
DECLARE $zip_url AS Utf8;
DECLARE $spritesheet_ext AS Utf8;
DECLARE $kind AS Utf8;
DECLARE $tags_json AS Utf8;
DECLARE $status AS Utf8;
DECLARE $owner_id AS Utf8;
DECLARE $owner_email AS Utf8;
DECLARE $owner_name AS Utf8;
DECLARE $contact_email AS Utf8;
DECLARE $rejection_reason AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $approved_at AS Utf8;
DECLARE $rejected_at AS Utf8;

UPSERT INTO ${TABLES.pets}
(slug, id, display_name, description, spritesheet_url, pet_json_url, zip_url, spritesheet_ext, kind, tags_json, status, owner_id, owner_email, owner_name, contact_email, rejection_reason, created_at, updated_at, approved_at, rejected_at)
VALUES ($slug, $id, $display_name, $description, $spritesheet_url, $pet_json_url, $zip_url, $spritesheet_ext, $kind, $tags_json, $status, $owner_id, $owner_email, $owner_name, $contact_email, $rejection_reason, $created_at, $updated_at, $approved_at, $rejected_at);
      `,
      {
        $slug: TypedValues.utf8(slug),
        $id: TypedValues.utf8(id),
        $display_name: TypedValues.utf8(input.petJson.displayName),
        $description: TypedValues.utf8(input.petJson.description),
        $spritesheet_url: TypedValues.utf8(input.spritesheetUrl),
        $pet_json_url: TypedValues.utf8(input.petJsonUrl),
        $zip_url: TypedValues.utf8(input.zipUrl),
        $spritesheet_ext: TypedValues.utf8(input.spritesheetExt),
        $kind: TypedValues.utf8(input.kind),
        $tags_json: TypedValues.utf8(JSON.stringify(input.tags)),
        $status: TypedValues.utf8("pending"),
        $owner_id: TypedValues.utf8(input.ownerId),
        $owner_email: TypedValues.utf8(input.ownerEmail ?? ""),
        $owner_name: TypedValues.utf8(input.ownerName ?? ""),
        $contact_email: TypedValues.utf8(input.contactEmail ?? ""),
        $rejection_reason: TypedValues.utf8(""),
        $created_at: TypedValues.utf8(now),
        $updated_at: TypedValues.utf8(now),
        $approved_at: TypedValues.utf8(""),
        $rejected_at: TypedValues.utf8(""),
      },
    ),
  );

  return toPublicPet(
    {
      slug,
      id,
      displayName: input.petJson.displayName,
      description: input.petJson.description,
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
    },
    EMPTY_METRICS,
  );
}

export async function moderatePet(input: {
  petId: string;
  reviewerId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<PublicPet | null> {
  if (isMockPetsDataSource()) {
    const pet = moderateMockPet(input);
    return pet ? toPublicPet(pet, pet.metrics) : null;
  }

  const pet = await getPetById(input.petId);
  if (!pet) return null;

  const now = new Date().toISOString();
  const nextStatus = statusAfterModeration(pet.status, input.decision);
  const approvedAt = nextStatus === "approved" ? now : pet.approvedAt ?? "";
  const rejectedAt = nextStatus === "rejected" ? now : "";
  const reason = nextStatus === "rejected" ? input.reason?.trim() ?? "" : "";

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $slug AS Utf8;
DECLARE $status AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $approved_at AS Utf8;
DECLARE $rejected_at AS Utf8;
DECLARE $rejection_reason AS Utf8;

UPDATE ${TABLES.pets}
SET status = $status,
    updated_at = $updated_at,
    approved_at = $approved_at,
    rejected_at = $rejected_at,
    rejection_reason = $rejection_reason
WHERE slug = $slug;
      `,
      {
        $slug: TypedValues.utf8(pet.slug),
        $status: TypedValues.utf8(nextStatus),
        $updated_at: TypedValues.utf8(now),
        $approved_at: TypedValues.utf8(approvedAt),
        $rejected_at: TypedValues.utf8(rejectedAt),
        $rejection_reason: TypedValues.utf8(reason),
      },
    ),
  );

  await insertReview({
    petId: input.petId,
    reviewerId: input.reviewerId,
    decision: input.decision,
    reason,
  });

  return toPublicPet(
    {
      ...pet,
      status: nextStatus,
      updatedAt: now,
      approvedAt: approvedAt || null,
      rejectedAt: rejectedAt || null,
      rejectionReason: reason || null,
    },
    EMPTY_METRICS,
  );
}

export async function softDeletePetByIdForOwner(input: {
  petId: string;
  ownerId: string;
}): Promise<boolean> {
  return softDeletePetById({
    petId: input.petId,
    actorUserId: input.ownerId,
    actorRole: "user",
  });
}

export async function softDeletePetById(input: {
  petId: string;
  actorUserId: string;
  actorRole: "user" | "admin";
}): Promise<boolean> {
  if (isMockPetsDataSource()) {
    return softDeleteMockPetById(input);
  }

  const pet = await getPetById(input.petId);
  if (!pet || pet.status === "deleted") {
    return false;
  }
  if (input.actorRole !== "admin" && pet.ownerId !== input.actorUserId) {
    return false;
  }

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $slug AS Utf8;
DECLARE $status AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.pets}
SET status = $status,
    updated_at = $updated_at
WHERE slug = $slug;
      `,
      {
        $slug: TypedValues.utf8(pet.slug),
        $status: TypedValues.utf8("deleted"),
        $updated_at: TypedValues.utf8(new Date().toISOString()),
      },
    ),
  );

  return true;
}

export async function incrementDownload(slug: string): Promise<void> {
  if (isMockPetsDataSource()) {
    incrementMockDownload(slug);
    return;
  }

  if (!isYdbConfigured()) return;

  const current = await getMetrics(slug);
  const now = new Date().toISOString();

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $pet_slug AS Utf8;
DECLARE $download_count AS Uint32;
DECLARE $install_count AS Uint32;
DECLARE $like_count AS Uint32;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.metrics}
(pet_slug, download_count, install_count, like_count, updated_at)
VALUES ($pet_slug, $download_count, $install_count, $like_count, $updated_at);
      `,
      {
        $pet_slug: TypedValues.utf8(slug),
        $download_count: TypedValues.uint32(current.downloadCount + 1),
        $install_count: TypedValues.uint32(current.installCount),
        $like_count: TypedValues.uint32(current.likeCount),
        $updated_at: TypedValues.utf8(now),
      },
    ),
  );
}

export async function incrementLike(slug: string): Promise<number> {
  if (isMockPetsDataSource()) {
    return incrementMockLike(slug);
  }

  if (!isYdbConfigured()) return 0;

  const current = await getMetrics(slug);
  const nextLikeCount = current.likeCount + 1;
  const now = new Date().toISOString();

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $pet_slug AS Utf8;
DECLARE $download_count AS Uint32;
DECLARE $install_count AS Uint32;
DECLARE $like_count AS Uint32;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.metrics}
(pet_slug, download_count, install_count, like_count, updated_at)
VALUES ($pet_slug, $download_count, $install_count, $like_count, $updated_at);
      `,
      {
        $pet_slug: TypedValues.utf8(slug),
        $download_count: TypedValues.uint32(current.downloadCount),
        $install_count: TypedValues.uint32(current.installCount),
        $like_count: TypedValues.uint32(nextLikeCount),
        $updated_at: TypedValues.utf8(now),
      },
    ),
  );

  return nextLikeCount;
}

export async function getPetMetrics(
  slug: string,
): Promise<PublicPetMetrics> {
  if (isMockPetsDataSource()) {
    const pet = getMockPetBySlug(slug);
    const metrics = pet?.metrics ?? EMPTY_METRICS;
    return {
      downloadCount: metrics.downloadCount,
      likeCount: metrics.likeCount,
    };
  }

  const metrics = await getMetrics(slug);
  return {
    downloadCount: metrics.downloadCount,
    likeCount: metrics.likeCount,
  };
}

async function getPetById(id: string): Promise<PetRow | null> {
  if (isMockPetsDataSource()) {
    return getMockPetById(id);
  }

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $id AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE id = $id
LIMIT 1;
      `,
      { $id: TypedValues.utf8(id) },
    ),
  );
  return rowsFromResult(result).map(parsePetRow)[0] ?? null;
}

async function resolveUniqueSlug(base: string): Promise<string> {
  if (!(await getPetBySlug(base))) return base;

  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 48);
    if (!(await getPetBySlug(candidate))) return candidate;
  }

  return `${base.slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;
}

async function getMetrics(slug: string): Promise<PetMetrics> {
  const metrics = await getMetricsBySlugs([slug]);
  return metrics.get(slug) ?? EMPTY_METRICS;
}

async function getMetricsBySlugs(slugs: string[]): Promise<Map<string, PetMetrics>> {
  if (!isYdbConfigured() || slugs.length === 0) return new Map();

  const uniqueSlugs = Array.from(new Set(slugs));
  const declarations = uniqueSlugs
    .map((_, index) => `DECLARE $slug${index} AS Utf8;`)
    .join("\n");
  const predicate = uniqueSlugs
    .map((_, index) => `pet_slug = $slug${index}`)
    .join(" OR ");
  const params = Object.fromEntries(
    uniqueSlugs.map((slug, index) => [`$slug${index}`, TypedValues.utf8(slug)]),
  );

  const result = await withSession((session) =>
    session.executeQuery(
      `
${declarations}
SELECT pet_slug, download_count, install_count, like_count
FROM ${TABLES.metrics}
WHERE ${predicate};
      `,
      params,
    ),
  );

  const metrics = new Map<string, PetMetrics>();
  for (const row of rowsFromResult(result)) {
    metrics.set(textAt(row, 0), {
      downloadCount: uintAt(row, 1),
      installCount: uintAt(row, 2),
      likeCount: uintAt(row, 3),
    });
  }
  return metrics;
}

async function insertReview(input: {
  petId: string;
  reviewerId: string;
  decision: string;
  reason: string;
}): Promise<void> {
  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $id AS Utf8;
DECLARE $pet_id AS Utf8;
DECLARE $reviewer_id AS Utf8;
DECLARE $decision AS Utf8;
DECLARE $reason AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.reviews}
(id, pet_id, reviewer_id, decision, reason, created_at)
VALUES ($id, $pet_id, $reviewer_id, $decision, $reason, $created_at);
      `,
      {
        $id: TypedValues.utf8(
          `review_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`,
        ),
        $pet_id: TypedValues.utf8(input.petId),
        $reviewer_id: TypedValues.utf8(input.reviewerId),
        $decision: TypedValues.utf8(input.decision),
        $reason: TypedValues.utf8(input.reason),
        $created_at: TypedValues.utf8(new Date().toISOString()),
      },
    ),
  );
}

function petColumns(): string {
  return [
    "slug",
    "id",
    "display_name",
    "description",
    "spritesheet_url",
    "pet_json_url",
    "zip_url",
    "spritesheet_ext",
    "kind",
    "tags_json",
    "status",
    "owner_id",
    "owner_email",
    "owner_name",
    "contact_email",
    "rejection_reason",
    "created_at",
    "updated_at",
    "approved_at",
    "rejected_at",
  ].join(", ");
}

function parsePetRow(row: Parameters<typeof textAt>[0]): PetRow {
  return {
    slug: textAt(row, 0),
    id: textAt(row, 1),
    displayName: textAt(row, 2),
    description: textAt(row, 3),
    spritesheetUrl: textAt(row, 4),
    petJsonUrl: textAt(row, 5),
    zipUrl: textAt(row, 6),
    spritesheetExt: textAt(row, 7) === "png" ? "png" : "webp",
    kind: parseKind(textAt(row, 8)),
    tags: parseTags(textAt(row, 9)),
    status: parseStatus(textAt(row, 10)),
    ownerId: textAt(row, 11),
    ownerEmail: textAt(row, 12) || null,
    ownerName: textAt(row, 13) || null,
    contactEmail: textAt(row, 14) || null,
    rejectionReason: textAt(row, 15) || null,
    createdAt: textAt(row, 16),
    updatedAt: textAt(row, 17),
    approvedAt: textAt(row, 18) || null,
    rejectedAt: textAt(row, 19) || null,
  };
}

function toPublicPet(
  row: PetRow,
  metrics: PublicPetMetrics,
): PublicPet {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    spritesheetUrl: toPublicUrl(row.spritesheetUrl),
    petJsonUrl: toPublicUrl(row.petJsonUrl),
    zipUrl: toPublicUrl(row.zipUrl),
    spritesheetExt: row.spritesheetExt,
    kind: row.kind,
    tags: row.tags,
    status: row.status,
    ownerName: row.ownerName,
    contactEmail: row.contactEmail,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    downloadCount: metrics.downloadCount,
    likeCount: metrics.likeCount,
  };
}

function toPublicUrl(value: string): string {
  return value.startsWith("/") ? withBasePath(value) : value;
}

function listMockPets(
  filters: PetFilters,
  status: ApprovalStatus,
): PublicPet[] {
  const q = filters.q?.trim().toLowerCase();

  return listMockPetRecords().filter((pet) => {
    if (pet.status !== status) return false;
    if (filters.kind && filters.kind !== "all" && pet.kind !== filters.kind) {
      return false;
    }
    if (!q) return true;
    return (
      pet.displayName.toLowerCase().includes(q) ||
      pet.description.toLowerCase().includes(q) ||
      pet.tags.some((tag) => tag.includes(q))
    );
  }).map((pet) => toPublicPet(pet, pet.metrics));
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseKind(value: string): PetKind {
  if (value === "object" || value === "character") return value;
  return "creature";
}

function parseStatus(value: string): ApprovalStatus {
  if (value === "approved" || value === "rejected" || value === "deleted") {
    return value;
  }
  return "pending";
}
