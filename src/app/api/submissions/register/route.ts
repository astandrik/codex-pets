import { NextResponse } from "next/server";

import { jsonApiError, jsonValidationError } from "@/lib/api-error";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/repository";
import {
  claimIdempotencyKey,
  hashBuffer,
  hashIdempotencyPayload,
  holdIdempotencyClaim,
  type IdempotencyClaim,
  readIdempotencyKey,
  storeIdempotencyResult,
} from "@/lib/idempotency";
import { storePetAssetsInYdb } from "@/lib/pets/assets-repository";
import { validatePublicAuthorName } from "@/lib/pets/author-attribution";
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
  const contactEmail = formData.get("contactEmail");
  const publicAuthorName = formData.get("publicAuthorName");
  const contactEmailRaw =
    typeof contactEmail === "string" ? contactEmail.trim() : "";
  const publicAuthorNameRaw =
    typeof publicAuthorName === "string" ? publicAuthorName.trim() : "";
  const publishContactEmailRaw = formData.get("publishContactEmail");
  if (
    publishContactEmailRaw !== null &&
    publishContactEmailRaw !== "true" &&
    publishContactEmailRaw !== "false"
  ) {
    return jsonApiError("invalid_publish_contact_email", {
      status: 400,
      message: "publishContactEmail must be true or false.",
      field: "publishContactEmail",
    });
  }
  const publishContactEmail = publishContactEmailRaw === "true";
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
  const effectiveContactEmail =
    principal?.email ?? normalizedContactEmail?.email ?? null;
  if (publishContactEmail && !effectiveContactEmail) {
    return jsonApiError("public_email_requires_contact_email", {
      status: 400,
      message: "A contact email is required before requesting publication.",
      field: "publishContactEmail",
    });
  }
  if (!principal && publicAuthorNameRaw && !effectiveContactEmail) {
    return jsonApiError("public_author_name_requires_contact_email", {
      status: 400,
      message: "A contact email is required before setting a public author name.",
      field: "publicAuthorName",
    });
  }

  let ownerName = principal?.name ?? null;
  if (!principal && effectiveContactEmail) {
    const authorName = validatePublicAuthorName(publicAuthorNameRaw);
    if (!authorName.ok) return jsonValidationError(authorName);
    ownerName = authorName.value;
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
        publicAuthorName: ownerName,
        publishContactEmail,
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
      ownerName,
      contactEmail: effectiveContactEmail,
      publicEmailRequested: publishContactEmail,
      kind: normalizedKind,
      tags: normalizedTags,
      zipUrl: assetUrls.zipUrl,
      petJsonUrl: assetUrls.petJsonUrl,
      spritesheetUrl: assetUrls.spritesheetUrl,
      spritesheetExt,
    });
  } catch (error) {
    if (idempotency.key && requestHash && idempotencyClaim) {
      await holdIdempotencyClaim({
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
  publicAuthorName: string | null;
  publishContactEmail: boolean;
  normalizedKind: "creature" | "object" | "character";
  normalizedTags: string[];
}): string {
  return hashIdempotencyPayload({
    fields: {
      contactEmail: input.effectiveContactEmail,
      publicAuthorName: input.publicAuthorName,
      publishContactEmail: input.publishContactEmail,
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
    type: normalizedFileType(file),
    size: file.size,
    sha256: hashBuffer(buffer),
  };
}

function normalizedFileType(file: File): string {
  const type = file.type.trim().toLowerCase();
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return "application/zip";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".png")) return "image/png";
  return type === "application/octet-stream" ? "" : type;
}

function idempotencyRouteScope(
  route: string,
  principal: { userId: string } | null,
): string {
  return `${route}#${principal ? `user:${principal.userId}` : "anonymous"}`;
}
