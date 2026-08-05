import { TABLES } from "@/lib/ydb/schema";
import { TypedValues, withSession, isYdbConfigured } from "@/lib/ydb/client";
import { rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import {
  listPublicUserProfilesByIds,
  normalizeProfileSlug,
} from "@/lib/auth/repository";
import {
  MOCK_LOCAL_ADMIN_AVATAR_ID,
  avatarUrlFromId,
} from "@/lib/auth/avatar-repository";
import type { PublicUserReference } from "@/lib/auth/repository";
import type { ApprovalStatus, PetKind, PublicPet } from "@/lib/pets/types";
import { withBasePath } from "@/lib/base-path";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import { slugify, type PetJson } from "@/lib/pets/validation";
import { statusAfterModeration } from "@/lib/pets/moderation";
import {
  matchesGalleryFilters,
  normalizeGalleryFilters,
} from "@/lib/pets/gallery-filters";
import { deletePetSearchIndexBestEffort } from "@/lib/pets/search-maintenance";
import {
  createMockPetRecord,
  getMockPetById,
  getMockPetBySlug,
  incrementMockDownload,
  incrementMockInstall,
  incrementMockLike,
  isMockPetsDataSource,
  listMockPetRecords,
  moderateMockPet,
  softDeleteMockPetById,
} from "@/lib/pets/mock-data";

export type PublicPetMetrics = {
  downloadCount: number;
  installCount: number;
  likeCount: number;
};

type PetMetrics = PublicPetMetrics;

const EMPTY_METRICS: PetMetrics = {
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};
const PET_STATUS_WRITE_MAX_ATTEMPTS = 3;

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
  tags?: string[];
};

export type ApprovedPetSitemapEntry = {
  slug: string;
  createdAt: string;
  updatedAt: string | null;
  approvedAt: string | null;
};

export function approvedPetsCatalogQuery(): string {
  return approvedPetsQuery("");
}

export function approvedPetsNewestQuery(): string {
  return approvedPetsQuery("LIMIT 200");
}

function approvedPetsQuery(limitClause: "" | "LIMIT 200"): string {
  return `
DECLARE $status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE status = $status
ORDER BY created_at DESC, slug ASC${limitClause ? `\n${limitClause}` : ""};
  `;
}

export async function listApprovedPets(
  filters: PetFilters = {},
): Promise<PublicPet[]> {
  return listApprovedPetsWithQuery(filters, approvedPetsNewestQuery());
}

export async function listApprovedPetsForSearch(): Promise<PublicPet[]> {
  return listApprovedPetsWithQuery({}, approvedPetsCatalogQuery());
}

export async function listApprovedPetSitemapEntries(): Promise<
  ApprovedPetSitemapEntry[]
> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords()
      .filter((pet) => pet.status === "approved")
      .sort(comparePetRowsNewestFirst)
      .map(({ slug, createdAt, updatedAt, approvedAt }) => ({
        slug,
        createdAt,
        updatedAt,
        approvedAt,
      }));
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT slug, created_at, updated_at, approved_at
FROM ${TABLES.pets}
WHERE status = $status
ORDER BY created_at DESC, slug ASC;
      `,
      { $status: TypedValues.utf8("approved") },
    ),
  );

  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    createdAt: textAt(row, 1),
    updatedAt: textAt(row, 2) || null,
    approvedAt: textAt(row, 3) || null,
  }));
}

export async function listRelatedPetCandidates(): Promise<
  RelatedPetCandidate[]
> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords()
      .filter((pet) => pet.status === "approved")
      .map(
        ({ slug, displayName, kind, tags, description, approvedAt, createdAt }) => ({
          slug,
          displayName,
          kind,
          tags,
          description,
          approvedAt,
          createdAt,
        }),
      );
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT slug, display_name, kind, tags_json, description, approved_at, created_at
FROM ${TABLES.pets}
WHERE status = $status;
      `,
      { $status: TypedValues.utf8("approved") },
    ),
  );

  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    displayName: textAt(row, 1),
    kind: parseKind(textAt(row, 2)),
    tags: parseTags(textAt(row, 3)),
    description: textAt(row, 4),
    approvedAt: textAt(row, 5) || null,
    createdAt: textAt(row, 6),
  }));
}

export async function countApprovedPets(): Promise<number> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords().filter((pet) => pet.status === "approved").length;
  }

  if (!isYdbConfigured()) return 0;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT COUNT(*) AS approved_count
FROM ${TABLES.pets}
WHERE status = $status;
      `,
      { $status: TypedValues.utf8("approved") },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? uintAt(row, 0) : 0;
}

async function listApprovedPetsWithQuery(
  filters: PetFilters,
  query: string,
): Promise<PublicPet[]> {
  if (isMockPetsDataSource()) {
    return listMockPets(filters, "approved");
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      query,
      { $status: TypedValues.utf8("approved") },
    ),
  );

  const normalizedFilters = normalizeGalleryFilters(filters);
  const rows = rowsFromResult(result)
    .map(parsePetRow)
    .filter((pet) => matchesGalleryFilters(pet, normalizedFilters));
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));
  const profilesByUserId = await getOwnerProfilesByRows(rows);

  return rows.map((row) =>
    toPublicPet(
      row,
      metricsBySlug.get(row.slug) ?? EMPTY_METRICS,
      profilesByUserId.get(row.ownerId),
    ),
  );
}

export async function getApprovedPetBySlug(
  slug: string,
): Promise<PublicPet | null> {
  if (isMockPetsDataSource()) {
    const pet = getMockPetBySlug(slug);
    if (!pet || pet.status !== "approved") return null;
    return toPublicPet(pet, pet.metrics, mockOwnerReference(pet));
  }

  const pet = await getPetBySlug(slug);
  if (!pet || pet.status !== "approved") return null;
  const metrics = await getMetrics(slug);
  const profile = await getOwnerProfileByRow(pet);
  return toPublicPet(pet, metrics, profile);
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
    ).map((pet) => toPublicPet(pet, pet.metrics, mockOwnerReference(pet)));
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
  const profilesByUserId = await getOwnerProfilesByRows(rows);

  return rows.map((row) =>
    toPublicPet(
      row,
      metricsBySlug.get(row.slug) ?? EMPTY_METRICS,
      profilesByUserId.get(row.ownerId),
    ),
  );
}

export async function listApprovedPetsForOwner(
  ownerId: string,
): Promise<PublicPet[]> {
  if (isMockPetsDataSource()) {
    return listMockPetRecords()
      .filter((pet) => pet.ownerId === ownerId && pet.status === "approved")
      .map((pet) => toPublicPet(pet, pet.metrics, mockOwnerReference(pet)));
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $owner_id AS Utf8;
DECLARE $status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE owner_id = $owner_id AND status = $status
ORDER BY approved_at DESC, created_at DESC
LIMIT 200;
      `,
      {
        $owner_id: TypedValues.utf8(ownerId),
        $status: TypedValues.utf8("approved"),
      },
    ),
  );

  const rows = rowsFromResult(result).map(parsePetRow);
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));
  const profilesByUserId = await getOwnerProfilesByRows(rows);

  return rows.map((row) =>
    toPublicPet(
      row,
      metricsBySlug.get(row.slug) ?? EMPTY_METRICS,
      profilesByUserId.get(row.ownerId),
    ),
  );
}

export async function listApprovedPetsBySlugs(
  slugs: string[],
): Promise<PublicPet[]> {
  const uniqueSlugs = Array.from(new Set(slugs));

  if (isMockPetsDataSource()) {
    const petsBySlug = new Map(
      listMockPetRecords()
        .filter(
          (pet) => uniqueSlugs.includes(pet.slug) && pet.status === "approved",
        )
        .map((pet) => [
          pet.slug,
          toPublicPet(pet, pet.metrics, mockOwnerReference(pet)),
        ]),
    );
    return uniqueSlugs.flatMap((slug) => {
      const pet = petsBySlug.get(slug);
      return pet ? [pet] : [];
    });
  }

  if (!isYdbConfigured() || uniqueSlugs.length === 0) return [];

  const declarations = uniqueSlugs
    .map((_, index) => `DECLARE $slug${index} AS Utf8;`)
    .join("\n");
  const predicate = uniqueSlugs
    .map((_, index) => `slug = $slug${index}`)
    .join(" OR ");
  const params = Object.fromEntries(
    uniqueSlugs.map((slug, index) => [`$slug${index}`, TypedValues.utf8(slug)]),
  );

  const result = await withSession((session) =>
    session.executeQuery(
      `
${declarations}
DECLARE $status AS Utf8;
SELECT ${petColumns()}
FROM ${TABLES.pets}
WHERE status = $status AND (${predicate});
      `,
      { ...params, $status: TypedValues.utf8("approved") },
    ),
  );

  const rowsBySlug = new Map(
    rowsFromResult(result)
      .map(parsePetRow)
      .map((row) => [row.slug, row] as const),
  );
  const rows = uniqueSlugs.flatMap((slug) => {
    const row = rowsBySlug.get(slug);
    return row ? [row] : [];
  });
  const metricsBySlug = await getMetricsBySlugs(rows.map((row) => row.slug));
  const profilesByUserId = await getOwnerProfilesByRows(rows);

  return rows.map((row) =>
    toPublicPet(
      row,
      metricsBySlug.get(row.slug) ?? EMPTY_METRICS,
      profilesByUserId.get(row.ownerId),
    ),
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
  const profilesByUserId = await getOwnerProfilesByRows(rows);

  return rows.map((row) =>
    toPublicPet(
      row,
      metricsBySlug.get(row.slug) ?? EMPTY_METRICS,
      profilesByUserId.get(row.ownerId),
    ),
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

    return toPublicPet(pet, pet.metrics, mockOwnerReference(pet));
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

  const row: PetRow = {
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
  };
  return toPublicPet(row, EMPTY_METRICS, await getOwnerProfileByRow(row));
}

export async function moderatePet(input: {
  petId: string;
  reviewerId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<PublicPet | null> {
  return (await moderatePetWithPreviousStatus(input))?.pet ?? null;
}

export async function moderatePetWithPreviousStatus(input: {
  petId: string;
  reviewerId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<{
  pet: PublicPet;
  previousStatus: ApprovalStatus;
} | null> {
  if (isMockPetsDataSource()) {
    const previousStatus = getMockPetById(input.petId)?.status;
    const pet = moderateMockPet(input);
    if (pet?.status === "rejected") {
      await deletePetSearchIndexBestEffort(pet.slug);
    }
    return pet && previousStatus
      ? {
          pet: toPublicPet(pet, pet.metrics, mockOwnerReference(pet)),
          previousStatus,
        }
      : null;
  }

  let pet = await getPetById(input.petId);
  for (
    let attempt = 0;
    attempt < PET_STATUS_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (!pet) return null;

    const candidate = pet;
    const now = new Date().toISOString();
    const nextStatus = statusAfterModeration(candidate.status, input.decision);
    const approvedAt =
      nextStatus === "approved" ? now : candidate.approvedAt ?? "";
    const rejectedAt = nextStatus === "rejected" ? now : "";
    const reason =
      nextStatus === "rejected" ? input.reason?.trim() ?? "" : "";

    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $slug AS Utf8;
DECLARE $status AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $approved_at AS Utf8;
DECLARE $rejected_at AS Utf8;
DECLARE $rejection_reason AS Utf8;
DECLARE $expected_status AS Utf8;
DECLARE $expected_updated_at AS Utf8;

UPDATE ${TABLES.pets}
SET status = $status,
    updated_at = $updated_at,
    approved_at = $approved_at,
    rejected_at = $rejected_at,
    rejection_reason = $rejection_reason
WHERE slug = $slug
  AND status = $expected_status
  AND updated_at = $expected_updated_at;
        `,
        {
          $slug: TypedValues.utf8(candidate.slug),
          $status: TypedValues.utf8(nextStatus),
          $updated_at: TypedValues.utf8(now),
          $approved_at: TypedValues.utf8(approvedAt),
          $rejected_at: TypedValues.utf8(rejectedAt),
          $rejection_reason: TypedValues.utf8(reason),
          $expected_status: TypedValues.utf8(candidate.status),
          $expected_updated_at: TypedValues.utf8(candidate.updatedAt),
        },
      ),
    );

    const confirmed = await getPetById(input.petId);
    if (confirmed?.status === nextStatus && confirmed.updatedAt === now) {
      await insertReview({
        petId: input.petId,
        reviewerId: input.reviewerId,
        decision: input.decision,
        reason,
      });

      if (nextStatus === "rejected") {
        await deletePetSearchIndexBestEffort(candidate.slug);
      }

      return {
        pet: toPublicPet(
          confirmed,
          EMPTY_METRICS,
          await getOwnerProfileByRow(confirmed),
        ),
        previousStatus: candidate.status,
      };
    }
    pet = confirmed;
  }

  return null;
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
  return Boolean(await softDeletePetByIdWithPreviousStatus(input));
}

export async function softDeletePetByIdWithPreviousStatus(input: {
  petId: string;
  actorUserId: string;
  actorRole: "user" | "admin";
}): Promise<{ previousStatus: ApprovalStatus } | null> {
  if (isMockPetsDataSource()) {
    const pet = getMockPetById(input.petId);
    const deleted = softDeleteMockPetById(input);
    if (deleted && pet) {
      await deletePetSearchIndexBestEffort(pet.slug);
      return { previousStatus: pet.status };
    }
    return null;
  }

  let pet = await getPetById(input.petId);
  for (
    let attempt = 0;
    attempt < PET_STATUS_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (!pet || pet.status === "deleted") {
      return null;
    }
    if (input.actorRole !== "admin" && pet.ownerId !== input.actorUserId) {
      return null;
    }

    const candidate = pet;
    const deletedAt = new Date().toISOString();
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $slug AS Utf8;
DECLARE $status AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $expected_status AS Utf8;
DECLARE $expected_updated_at AS Utf8;

UPDATE ${TABLES.pets}
SET status = $status,
    updated_at = $updated_at
WHERE slug = $slug
  AND status = $expected_status
  AND updated_at = $expected_updated_at;
        `,
        {
          $slug: TypedValues.utf8(candidate.slug),
          $status: TypedValues.utf8("deleted"),
          $updated_at: TypedValues.utf8(deletedAt),
          $expected_status: TypedValues.utf8(candidate.status),
          $expected_updated_at: TypedValues.utf8(candidate.updatedAt),
        },
      ),
    );

    const confirmed = await getPetById(input.petId);
    if (
      confirmed?.status === "deleted" &&
      confirmed.updatedAt === deletedAt
    ) {
      await deletePetSearchIndexBestEffort(candidate.slug);
      return { previousStatus: candidate.status };
    }
    pet = confirmed;
  }

  return null;
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

export async function incrementInstall(slug: string): Promise<void> {
  if (isMockPetsDataSource()) {
    incrementMockInstall(slug);
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
        $download_count: TypedValues.uint32(current.downloadCount),
        $install_count: TypedValues.uint32(current.installCount + 1),
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
      installCount: metrics.installCount,
      likeCount: metrics.likeCount,
    };
  }

  const metrics = await getMetrics(slug);
  return {
    downloadCount: metrics.downloadCount,
    installCount: metrics.installCount,
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

async function getOwnerProfileByRow(
  row: PetRow,
): Promise<PublicUserReference | undefined> {
  if (!row.ownerId) return undefined;
  return (await listPublicUserProfilesByIds([row.ownerId])).get(row.ownerId);
}

async function getOwnerProfilesByRows(
  rows: PetRow[],
): Promise<Map<string, PublicUserReference>> {
  return listPublicUserProfilesByIds(rows.map((row) => row.ownerId));
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
  ownerProfile?: PublicUserReference,
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
    ownerName: ownerProfile?.displayName ?? row.ownerName,
    ownerProfileSlug: ownerProfile?.profileSlug ?? null,
    ownerAvatarUrl: ownerProfile?.avatarUrl ?? null,
    contactEmail: row.contactEmail,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    downloadCount: metrics.downloadCount,
    installCount: metrics.installCount,
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
  const normalizedFilters = normalizeGalleryFilters(filters);

  return listMockPetRecords()
    .filter((pet) => {
      if (pet.status !== status) return false;
      return matchesGalleryFilters(pet, normalizedFilters);
    })
    .sort(comparePetRowsNewestFirst)
    .map((pet) => toPublicPet(pet, pet.metrics, mockOwnerReference(pet)));
}

function comparePetRowsNewestFirst(
  left: Pick<PetRow, "createdAt" | "slug">,
  right: Pick<PetRow, "createdAt" | "slug">,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    left.slug.localeCompare(right.slug)
  );
}

function mockOwnerReference(row: PetRow): PublicUserReference | undefined {
  if (!row.ownerId || !row.ownerName) return undefined;
  const profileSlug =
    normalizeProfileSlug(row.ownerId) ??
    normalizeProfileSlug(row.ownerName);
  if (!profileSlug) return undefined;

  return {
    userId: row.ownerId,
    displayName: row.ownerName,
    profileSlug,
    avatarUrl:
      profileSlug === "local-admin"
        ? avatarUrlFromId(MOCK_LOCAL_ADMIN_AVATAR_ID)
        : null,
  };
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
