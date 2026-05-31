import { NextResponse } from "next/server";

import { jsonApiError, jsonValidationError } from "@/lib/api-error";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/repository";
import {
  claimIdempotencyKey,
  hashBuffer,
  hashIdempotencyPayload,
  type IdempotencyClaim,
  idempotencyStorageUnavailableResponse,
  isIdempotencyStorageAvailable,
  readIdempotencyKey,
  releaseIdempotencyClaim,
  storeIdempotencyResult,
} from "@/lib/idempotency";
import { storePetAssetsInYdb } from "@/lib/pets/assets-repository";
import { createPendingPet } from "@/lib/pets/repository";
import { validateUploadedPackage } from "@/lib/pets/package";
import { normalizeKind, readTags } from "@/lib/pets/validation";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_ID = "POST /api/submissions/register";

export async function POST(req: Request): Promise<Response> {
  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) return idempotency.response;
  if (idempotency.key && !isIdempotencyStorageAvailable()) {
    return idempotencyStorageUnavailableResponse();
  }

  const principal = await getCurrentPrincipal();
  if (!isYdbConfigured()) {
    return jsonApiError("service_not_configured", {
      status: 503,
      message: "Codex Pets persistence is not configured.",
      hint: "Try again later or contact the site operator.",
    });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonApiError("invalid_form_data", {
      status: 400,
      message: "Multipart form data could not be read.",
      hint: "Submit zip, petjson, and sprite files as multipart/form-data.",
    });
  }

  const zip = formData.get("zip");
  const petjson = formData.get("petjson");
  const sprite = formData.get("sprite");
  const contactEmailRaw =
    typeof formData.get("contactEmail") === "string"
      ? String(formData.get("contactEmail")).trim()
      : "";
  const ext = formData.get("spritesheetExt");
  if (!(zip instanceof File) || !(petjson instanceof File) || !(sprite instanceof File)) {
    return jsonApiError("missing_files", {
      status: 400,
      message: "zip, petjson, and sprite files are required.",
      hint: "Upload a ZIP package, pet.json file, and spritesheet file.",
    });
  }
  const spritesheetExt = ext === "png" ? "png" : "webp";
  const normalizedContactEmail = contactEmailRaw
    ? normalizeEmail(contactEmailRaw)
    : null;
  if (contactEmailRaw && !normalizedContactEmail) {
    return jsonApiError("invalid_contact_email", {
      status: 400,
      message: "Contact email must be a valid email address.",
      hint: "Provide a reachable email address or sign in before submitting.",
      field: "contactEmail",
    });
  }

  const [petJsonBuffer, spritesheetBuffer, zipBuffer] = await Promise.all([
    Buffer.from(await petjson.arrayBuffer()),
    Buffer.from(await sprite.arrayBuffer()),
    Buffer.from(await zip.arrayBuffer()),
  ]);

  const validation = await validateUploadedPackage({
    petJsonBuffer,
    spritesheetBuffer,
    zipBuffer,
    spritesheetExt,
  });
  if (!validation.ok) {
    return jsonValidationError(validation);
  }

  const normalizedKind = normalizeKind(formData.get("kind"));
  const normalizedTags = readTags(
    String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
  const routeScope = idempotencyRouteScope(ROUTE_ID, principal);
  const requestHash = idempotency.key
    ? hashSubmissionRequest({
        zip,
        petjson,
        sprite,
        zipBuffer,
        petJsonBuffer,
        spritesheetBuffer,
        spritesheetExt,
        effectiveContactEmail:
          principal?.email?.toLowerCase() ??
          normalizedContactEmail?.emailLower ??
          null,
        normalizedKind,
        normalizedTags,
      })
    : null;
  let idempotencyClaim: IdempotencyClaim | null = null;
  if (idempotency.key && requestHash) {
    const replay = await claimIdempotencyKey({
      route: routeScope,
      key: idempotency.key,
      requestHash,
    });
    if (replay.kind !== "fresh") return replay.response;
    idempotencyClaim = replay.claim;
  }

  let pet: Awaited<ReturnType<typeof createPendingPet>>;
  try {
    const assetId = `asset_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const assetUrls = await storePetAssetsInYdb({
      assetId,
      petJsonBuffer,
      spritesheetBuffer,
      zipBuffer,
      spritesheetExt,
    });

    pet = await createPendingPet({
      petJson: validation.value.petJson,
      ownerId: principal?.userId ?? "",
      ownerEmail: principal?.email ?? null,
      ownerName: principal?.name ?? null,
      contactEmail: principal?.email ?? normalizedContactEmail?.email ?? null,
      kind: normalizedKind,
      tags: normalizedTags,
      zipUrl: assetUrls.zipUrl,
      petJsonUrl: assetUrls.petJsonUrl,
      spritesheetUrl: assetUrls.spritesheetUrl,
      spritesheetExt,
    });
  } catch (error) {
    if (idempotency.key && requestHash && idempotencyClaim) {
      await releaseIdempotencyClaim({
        route: routeScope,
        key: idempotency.key,
        requestHash,
        claim: idempotencyClaim,
      }).catch(() => false);
    }
    throw error;
  }

  const responseBody = { ok: true, pet };
  if (idempotency.key && requestHash && idempotencyClaim) {
    const stored = await storeIdempotencyResult({
      route: routeScope,
      key: idempotency.key,
      requestHash,
      claim: idempotencyClaim,
      statusCode: 201,
      responseBody,
    });
    if (!stored) {
      return NextResponse.json(responseBody, { status: 201 });
    }
  }

  return NextResponse.json(responseBody, { status: 201 });
}

function hashSubmissionRequest(input: {
  zip: File;
  petjson: File;
  sprite: File;
  zipBuffer: Buffer;
  petJsonBuffer: Buffer;
  spritesheetBuffer: Buffer;
  spritesheetExt: "webp" | "png";
  effectiveContactEmail: string | null;
  normalizedKind: "creature" | "object" | "character";
  normalizedTags: string[];
}): string {
  return hashIdempotencyPayload({
    fields: {
      contactEmail: input.effectiveContactEmail,
      kind: input.normalizedKind,
      tags: input.normalizedTags,
      spritesheetExt: input.spritesheetExt,
    },
    files: {
      zip: fileHash(input.zip, input.zipBuffer),
      petjson: fileHash(input.petjson, input.petJsonBuffer),
      sprite: fileHash(input.sprite, input.spritesheetBuffer),
    },
  });
}

function fileHash(file: File, buffer: Buffer) {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    sha256: hashBuffer(buffer),
  };
}

function idempotencyRouteScope(
  route: string,
  principal: { userId: string } | null,
): string {
  return `${route}#${principal ? `user:${principal.userId}` : "anonymous"}`;
}
