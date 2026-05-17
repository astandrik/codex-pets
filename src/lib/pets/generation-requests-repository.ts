import type { Session } from "ydb-sdk";

import { withBasePath } from "@/lib/base-path";
import { TABLES } from "@/lib/ydb/schema";
import { TypedValues, isYdbConfigured, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import type {
  GenerationRequestStatus,
  PetGenerationRequest,
  PetGenerationRequestReferenceImage,
  PetKind,
} from "@/lib/pets/types";
import type { CreatePetGenerationRequestInput } from "@/lib/pets/generation-requests";
import {
  getMockPetById,
  getMockPetBySlug,
  isMockPetsDataSource,
} from "@/lib/pets/mock-data";

export type CreateGenerationRequestRecordInput =
  CreatePetGenerationRequestInput & {
    requesterUserId: string | null;
    referenceImage?: CreateGenerationRequestImageInput | null;
  };

export type CreateGenerationRequestImageInput = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
};

export type GenerationRequestImageResult = {
  requestId: string;
  requesterUserId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
};

type PetLinkTarget = {
  id: string;
  slug: string;
  status: string;
};

export type FulfillGenerationRequestResult =
  | { ok: true; request: PetGenerationRequest }
  | {
      ok: false;
      error: "request_not_found" | "pet_not_found" | "pet_deleted";
    };

const OPEN_REQUEST_STATUSES = new Set<GenerationRequestStatus>([
  "pending",
  "in_progress",
]);
const mockGenerationRequestsById = new Map<string, PetGenerationRequest>();
const mockGenerationRequestImagesById = new Map<
  string,
  CreateGenerationRequestImageInput
>();

export async function createGenerationRequest(
  input: CreateGenerationRequestRecordInput,
): Promise<PetGenerationRequest> {
  const now = new Date().toISOString();
  const requestId = `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const request: PetGenerationRequest = {
    id: requestId,
    status: "pending",
    kind: input.kind,
    displayNameHint: input.displayNameHint,
    prompt: input.prompt,
    contactEmail: input.contactEmail,
    requesterName: input.requesterName,
    requesterUserId: input.requesterUserId,
    linkedPetId: null,
    linkedPetSlug: null,
    referenceImage: input.referenceImage
      ? toReferenceImage(input.referenceImage, requestId)
      : null,
    adminNote: null,
    createdAt: now,
    updatedAt: now,
    fulfilledAt: null,
    rejectedAt: null,
  };

  if (isMockPetsDataSource()) {
    mockGenerationRequestsById.set(request.id, request);
    if (input.referenceImage) {
      mockGenerationRequestImagesById.set(request.id, input.referenceImage);
    }
    return request;
  }

  if (!isYdbConfigured()) return request;

  await withSession(async (session) => {
    await session.executeQuery(
      `
DECLARE $id AS Utf8;
DECLARE $status AS Utf8;
DECLARE $kind AS Utf8;
DECLARE $display_name_hint AS Utf8;
DECLARE $prompt AS Utf8;
DECLARE $contact_email AS Utf8;
DECLARE $requester_name AS Utf8;
DECLARE $requester_user_id AS Utf8;
DECLARE $linked_pet_id AS Utf8;
DECLARE $linked_pet_slug AS Utf8;
DECLARE $admin_note AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $fulfilled_at AS Utf8;
DECLARE $rejected_at AS Utf8;

UPSERT INTO ${TABLES.generationRequests}
(id, status, kind, display_name_hint, prompt, contact_email, requester_name, requester_user_id, linked_pet_id, linked_pet_slug, admin_note, created_at, updated_at, fulfilled_at, rejected_at)
VALUES ($id, $status, $kind, $display_name_hint, $prompt, $contact_email, $requester_name, $requester_user_id, $linked_pet_id, $linked_pet_slug, $admin_note, $created_at, $updated_at, $fulfilled_at, $rejected_at);
      `,
      toRequestParams(request),
    );

    if (input.referenceImage) {
      await storeGenerationRequestImage(session, request.id, input.referenceImage);
    }
  });

  return request;
}

export async function listGenerationRequests(): Promise<PetGenerationRequest[]> {
  if (isMockPetsDataSource()) {
    return Array.from(mockGenerationRequestsById.values())
      .filter((request) => request.status !== "deleted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $deleted_status AS Utf8;
DECLARE $pending_status AS Utf8;
DECLARE $in_progress_status AS Utf8;
SELECT ${generationRequestColumns()}
FROM ${TABLES.generationRequests} AS r
LEFT JOIN ${TABLES.generationRequestImages} AS i
ON r.id = i.request_id
WHERE r.status != $deleted_status
ORDER BY
  CASE
    WHEN r.status = $pending_status THEN 0
    WHEN r.status = $in_progress_status THEN 0
    ELSE 1
  END,
  r.created_at DESC
LIMIT 200;
      `,
      {
        $deleted_status: TypedValues.utf8("deleted"),
        $pending_status: TypedValues.utf8("pending"),
        $in_progress_status: TypedValues.utf8("in_progress"),
      },
    ),
  );

  return rowsFromResult(result).map(parseGenerationRequestRow);
}

export async function listGenerationRequestsForUser(
  requesterUserId: string,
): Promise<PetGenerationRequest[]> {
  if (isMockPetsDataSource()) {
    return Array.from(mockGenerationRequestsById.values())
      .filter(
        (request) =>
          request.requesterUserId === requesterUserId &&
          request.status !== "deleted",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $requester_user_id AS Utf8;
DECLARE $deleted_status AS Utf8;
SELECT ${generationRequestColumns()}
FROM ${TABLES.generationRequests} AS r
LEFT JOIN ${TABLES.generationRequestImages} AS i
ON r.id = i.request_id
WHERE r.requester_user_id = $requester_user_id
  AND r.status != $deleted_status
ORDER BY r.created_at DESC
LIMIT 200;
      `,
      {
        $requester_user_id: TypedValues.utf8(requesterUserId),
        $deleted_status: TypedValues.utf8("deleted"),
      },
    ),
  );

  return rowsFromResult(result).map(parseGenerationRequestRow);
}

export async function countOpenGenerationRequests(): Promise<number> {
  if (isMockPetsDataSource()) {
    return Array.from(mockGenerationRequestsById.values()).filter((request) =>
      OPEN_REQUEST_STATUSES.has(request.status),
    ).length;
  }

  if (!isYdbConfigured()) return 0;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $pending_status AS Utf8;
DECLARE $in_progress_status AS Utf8;
SELECT COUNT(*) AS open_count
FROM ${TABLES.generationRequests}
WHERE status = $pending_status OR status = $in_progress_status;
      `,
      {
        $pending_status: TypedValues.utf8("pending"),
        $in_progress_status: TypedValues.utf8("in_progress"),
      },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? uintAt(row, 0) : 0;
}

export async function markGenerationRequestInProgress(input: {
  requestId: string;
  adminNote?: string | null;
}): Promise<PetGenerationRequest | null> {
  const request = await getGenerationRequestById(input.requestId);
  if (!request || request.status === "deleted") return null;

  return updateGenerationRequest({
    ...request,
    status: request.status === "pending" ? "in_progress" : request.status,
    adminNote: input.adminNote ?? request.adminNote,
    updatedAt: new Date().toISOString(),
  });
}

export async function rejectGenerationRequest(input: {
  requestId: string;
  adminNote?: string | null;
}): Promise<PetGenerationRequest | null> {
  const request = await getGenerationRequestById(input.requestId);
  if (!request || request.status === "deleted") return null;

  const now = new Date().toISOString();
  return updateGenerationRequest({
    ...request,
    status: "rejected",
    adminNote: input.adminNote ?? request.adminNote,
    updatedAt: now,
    rejectedAt: now,
  });
}

export async function softDeleteGenerationRequest(
  requestId: string,
): Promise<boolean> {
  const request = await getGenerationRequestById(requestId);
  if (!request || request.status === "deleted") return false;

  await updateGenerationRequest({
    ...request,
    status: "deleted",
    updatedAt: new Date().toISOString(),
  });

  return true;
}

export async function fulfillGenerationRequest(input: {
  requestId: string;
  petLookup: string;
  adminNote?: string | null;
}): Promise<FulfillGenerationRequestResult> {
  const request = await getGenerationRequestById(input.requestId);
  if (!request || request.status === "deleted") {
    return { ok: false, error: "request_not_found" };
  }

  const pet = await getPetLinkTarget(input.petLookup);
  if (!pet) return { ok: false, error: "pet_not_found" };
  if (pet.status === "deleted") return { ok: false, error: "pet_deleted" };

  const now = new Date().toISOString();
  const updated = await updateGenerationRequest({
    ...request,
    status: "fulfilled",
    linkedPetId: pet.id,
    linkedPetSlug: pet.slug,
    adminNote: input.adminNote ?? request.adminNote,
    updatedAt: now,
    fulfilledAt: now,
  });

  return updated
    ? { ok: true, request: updated }
    : { ok: false, error: "request_not_found" };
}

export async function readGenerationRequestImage(
  requestId: string,
): Promise<GenerationRequestImageResult | null> {
  if (isMockPetsDataSource()) {
    const request = mockGenerationRequestsById.get(requestId);
    const image = mockGenerationRequestImagesById.get(requestId);
    if (!request || request.status === "deleted" || !image) return null;
    return {
      requestId,
      requesterUserId: request.requesterUserId,
      fileName: image.fileName,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
      buffer: image.buffer,
    };
  }

  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $id AS Utf8;
DECLARE $deleted_status AS Utf8;
SELECT r.id, r.requester_user_id, i.file_name, i.content_type, i.size_bytes, i.image_bytes
FROM ${TABLES.generationRequests} AS r
INNER JOIN ${TABLES.generationRequestImages} AS i
ON r.id = i.request_id
WHERE r.id = $id AND r.status != $deleted_status
LIMIT 1;
      `,
      {
        $id: TypedValues.utf8(requestId),
        $deleted_status: TypedValues.utf8("deleted"),
      },
    ),
  );

  const row = rowsFromResult(result)[0];
  if (!row) return null;
  return {
    requestId: textAt(row, 0),
    requesterUserId: textAt(row, 1) || null,
    fileName: textAt(row, 2),
    contentType: textAt(row, 3),
    sizeBytes: uintAt(row, 4),
    buffer: bytesAt(row, 5),
  };
}

async function getGenerationRequestById(
  id: string,
): Promise<PetGenerationRequest | null> {
  if (isMockPetsDataSource()) {
    return mockGenerationRequestsById.get(id) ?? null;
  }

  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
	DECLARE $id AS Utf8;
SELECT ${generationRequestColumns()}
FROM ${TABLES.generationRequests} AS r
LEFT JOIN ${TABLES.generationRequestImages} AS i
ON r.id = i.request_id
WHERE r.id = $id
LIMIT 1;
      `,
      { $id: TypedValues.utf8(id) },
    ),
  );

  return rowsFromResult(result).map(parseGenerationRequestRow)[0] ?? null;
}

async function updateGenerationRequest(
  request: PetGenerationRequest,
): Promise<PetGenerationRequest | null> {
  if (isMockPetsDataSource()) {
    mockGenerationRequestsById.set(request.id, request);
    return request;
  }

  if (!isYdbConfigured()) return request;

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $id AS Utf8;
DECLARE $status AS Utf8;
DECLARE $kind AS Utf8;
DECLARE $display_name_hint AS Utf8;
DECLARE $prompt AS Utf8;
DECLARE $contact_email AS Utf8;
DECLARE $requester_name AS Utf8;
DECLARE $requester_user_id AS Utf8;
DECLARE $linked_pet_id AS Utf8;
DECLARE $linked_pet_slug AS Utf8;
DECLARE $admin_note AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $fulfilled_at AS Utf8;
DECLARE $rejected_at AS Utf8;

UPSERT INTO ${TABLES.generationRequests}
(id, status, kind, display_name_hint, prompt, contact_email, requester_name, requester_user_id, linked_pet_id, linked_pet_slug, admin_note, created_at, updated_at, fulfilled_at, rejected_at)
VALUES ($id, $status, $kind, $display_name_hint, $prompt, $contact_email, $requester_name, $requester_user_id, $linked_pet_id, $linked_pet_slug, $admin_note, $created_at, $updated_at, $fulfilled_at, $rejected_at);
      `,
      toRequestParams(request),
    ),
  );

  return request;
}

async function getPetLinkTarget(lookup: string): Promise<PetLinkTarget | null> {
  if (isMockPetsDataSource()) {
    const pet = getMockPetBySlug(lookup) ?? getMockPetById(lookup);
    return pet ? { id: pet.id, slug: pet.slug, status: pet.status } : null;
  }

  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $lookup AS Utf8;
SELECT id, slug, status
FROM ${TABLES.pets}
WHERE id = $lookup OR slug = $lookup
LIMIT 1;
      `,
      { $lookup: TypedValues.utf8(lookup) },
    ),
  );

  const row = rowsFromResult(result)[0];
  if (!row) return null;
  return {
    id: textAt(row, 0),
    slug: textAt(row, 1),
    status: textAt(row, 2),
  };
}

async function storeGenerationRequestImage(
  session: Session,
  requestId: string,
  image: CreateGenerationRequestImageInput,
): Promise<void> {
  await session.executeQuery(
    `
DECLARE $request_id AS Utf8;
DECLARE $file_name AS Utf8;
DECLARE $content_type AS Utf8;
DECLARE $size_bytes AS Uint32;
DECLARE $image_bytes AS String;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.generationRequestImages}
(request_id, file_name, content_type, size_bytes, image_bytes, created_at)
VALUES ($request_id, $file_name, $content_type, $size_bytes, $image_bytes, $created_at);
    `,
    {
      $request_id: TypedValues.utf8(requestId),
      $file_name: TypedValues.utf8(image.fileName),
      $content_type: TypedValues.utf8(image.contentType),
      $size_bytes: TypedValues.uint32(image.sizeBytes),
      $image_bytes: TypedValues.bytes(image.buffer),
      $created_at: TypedValues.utf8(new Date().toISOString()),
    },
  );
}

function generationRequestColumns(): string {
  return [
    "r.id",
    "r.status",
    "r.kind",
    "r.display_name_hint",
    "r.prompt",
    "r.contact_email",
    "r.requester_name",
    "r.requester_user_id",
    "r.linked_pet_id",
    "r.linked_pet_slug",
    "r.admin_note",
    "r.created_at",
    "r.updated_at",
    "r.fulfilled_at",
    "r.rejected_at",
    "i.file_name",
    "i.content_type",
    "i.size_bytes",
  ].join(", ");
}

function toRequestParams(request: PetGenerationRequest) {
  return {
    $id: TypedValues.utf8(request.id),
    $status: TypedValues.utf8(request.status),
    $kind: TypedValues.utf8(request.kind),
    $display_name_hint: TypedValues.utf8(request.displayNameHint ?? ""),
    $prompt: TypedValues.utf8(request.prompt),
    $contact_email: TypedValues.utf8(request.contactEmail),
    $requester_name: TypedValues.utf8(request.requesterName ?? ""),
    $requester_user_id: TypedValues.utf8(request.requesterUserId ?? ""),
    $linked_pet_id: TypedValues.utf8(request.linkedPetId ?? ""),
    $linked_pet_slug: TypedValues.utf8(request.linkedPetSlug ?? ""),
    $admin_note: TypedValues.utf8(request.adminNote ?? ""),
    $created_at: TypedValues.utf8(request.createdAt),
    $updated_at: TypedValues.utf8(request.updatedAt),
    $fulfilled_at: TypedValues.utf8(request.fulfilledAt ?? ""),
    $rejected_at: TypedValues.utf8(request.rejectedAt ?? ""),
  };
}

function parseGenerationRequestRow(
  row: Parameters<typeof textAt>[0],
): PetGenerationRequest {
  return {
    id: textAt(row, 0),
    status: parseStatus(textAt(row, 1)),
    kind: parseKind(textAt(row, 2)),
    displayNameHint: textAt(row, 3) || null,
    prompt: textAt(row, 4),
    contactEmail: textAt(row, 5),
    requesterName: textAt(row, 6) || null,
    requesterUserId: textAt(row, 7) || null,
    linkedPetId: textAt(row, 8) || null,
    linkedPetSlug: textAt(row, 9) || null,
    referenceImage: parseReferenceImage(textAt(row, 0), row, 15),
    adminNote: textAt(row, 10) || null,
    createdAt: textAt(row, 11),
    updatedAt: textAt(row, 12),
    fulfilledAt: textAt(row, 13) || null,
    rejectedAt: textAt(row, 14) || null,
  };
}

function parseReferenceImage(
  requestId: string,
  row: Parameters<typeof textAt>[0],
  startIndex: number,
): PetGenerationRequestReferenceImage | null {
  const fileName = textAt(row, startIndex);
  if (!fileName) return null;
  return {
    url: generationRequestImageUrl(requestId),
    fileName,
    contentType: textAt(row, startIndex + 1),
    sizeBytes: uintAt(row, startIndex + 2),
  };
}

function toReferenceImage(
  image: Pick<
    CreateGenerationRequestImageInput,
    "fileName" | "contentType" | "sizeBytes"
  >,
  requestId: string,
): PetGenerationRequestReferenceImage {
  return {
    url: generationRequestImageUrl(requestId),
    fileName: image.fileName,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
  };
}

function generationRequestImageUrl(requestId: string): string {
  return withBasePath(
    `/api/generation-requests/${encodeURIComponent(requestId)}/image`,
  );
}

function parseKind(value: string): PetKind {
  if (value === "object" || value === "character") return value;
  return "creature";
}

function parseStatus(value: string): GenerationRequestStatus {
  if (
    value === "in_progress" ||
    value === "fulfilled" ||
    value === "rejected" ||
    value === "deleted"
  ) {
    return value;
  }
  return "pending";
}
