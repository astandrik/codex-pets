import { NextResponse } from "next/server";
import sharp from "sharp";

import { jsonApiError, jsonValidationError } from "@/lib/api-error";
import { getCurrentPrincipal } from "@/lib/auth/session";
import {
  claimIdempotencyKey,
  hashBuffer,
  hashIdempotencyPayload,
  idempotencyStorageUnavailableResponse,
  isIdempotencyStorageAvailable,
  readIdempotencyKey,
  storeIdempotencyResult,
} from "@/lib/idempotency";
import {
  type CreatePetGenerationRequestInput,
  validateCreatePetGenerationRequest,
} from "@/lib/pets/generation-requests";
import {
  createGenerationRequest,
  type CreateGenerationRequestImageInput,
} from "@/lib/pets/generation-requests-repository";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const ROUTE_ID = "POST /api/generation-requests";
const REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type ParsedRequestBody =
  | {
      ok: true;
      body: unknown;
      referenceImage: CreateGenerationRequestImageInput | null;
    }
  | {
      ok: false;
      response: Response;
    };

export async function POST(req: Request): Promise<Response> {
  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) return idempotency.response;
  if (idempotency.key && !isIdempotencyStorageAvailable()) {
    return idempotencyStorageUnavailableResponse();
  }

  const principal = await getCurrentPrincipal();
  if (!isYdbConfigured() && !isMockPetsDataSource()) {
    return jsonApiError("service_not_configured", {
      status: 503,
      message: "Codex Pets persistence is not configured.",
      hint: "Try again later or contact the site operator.",
    });
  }

  const parsed = await readRequestBody(req);
  if (!parsed.ok) return parsed.response;

  const validation = validateCreatePetGenerationRequest(parsed.body);
  if (!validation.ok) {
    return jsonValidationError(validation);
  }

  const routeScope = idempotencyRouteScope(ROUTE_ID, principal);
  const requestHash = idempotency.key
    ? hashGenerationRequest(validation.value, parsed.referenceImage)
    : null;
  if (idempotency.key && requestHash) {
    const replay = await claimIdempotencyKey({
      route: routeScope,
      key: idempotency.key,
      requestHash,
    });
    if (replay.kind !== "fresh") return replay.response;
  }

  const request = await createGenerationRequest({
    ...validation.value,
    requesterUserId: principal?.userId ?? null,
    referenceImage: parsed.referenceImage,
  });

  const responseBody = {
    ok: true,
    request: {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
    },
  };

  if (idempotency.key && requestHash) {
    const stored = await storeIdempotencyResult({
      route: routeScope,
      key: idempotency.key,
      requestHash,
      statusCode: 201,
      responseBody,
    });
    if (!stored) return idempotencyStorageUnavailableResponse();
  }

  return NextResponse.json(responseBody, { status: 201 });
}

async function readRequestBody(req: Request): Promise<ParsedRequestBody> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    return readMultipartRequest(req);
  }

  try {
    return {
      ok: true,
      body: await req.json(),
      referenceImage: null,
    };
  } catch {
    return {
      ok: false,
      response: jsonApiError("invalid_json", {
        status: 400,
        message: "Request body must be valid JSON.",
        hint: "Send application/json or multipart/form-data.",
      }),
    };
  }
}

async function readMultipartRequest(req: Request): Promise<ParsedRequestBody> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return {
      ok: false,
      response: jsonApiError("invalid_form_data", {
        status: 400,
        message: "Multipart form data could not be read.",
        hint: "Send contactEmail and prompt fields with an optional referenceImage file.",
      }),
    };
  }

  const image = formData.get("referenceImage");
  const referenceImage = image
    ? await readReferenceImage(image)
    : { ok: true as const, image: null };
  if (!referenceImage.ok) {
    return {
      ok: false,
      response: jsonValidationError(referenceImage.error),
    };
  }

  return {
    ok: true,
    body: {
      contactEmail: stringField(formData, "contactEmail"),
      requesterName: stringField(formData, "requesterName"),
      displayNameHint: stringField(formData, "displayNameHint"),
      prompt: stringField(formData, "prompt"),
      kind: stringField(formData, "kind"),
    },
    referenceImage: referenceImage.image,
  };
}

async function readReferenceImage(
  value: FormDataEntryValue,
): Promise<
  | { ok: true; image: CreateGenerationRequestImageInput | null }
  | {
      ok: false;
      error: { error: string; field: "referenceImage"; message: string };
    }
> {
  if (!(value instanceof File)) {
    return {
      ok: false,
      error: {
        error: "invalid_reference_image",
        field: "referenceImage",
        message: "Reference image must be a file.",
      },
    };
  }

  if (value.size <= 0) {
    return { ok: true, image: null };
  }

  if (value.size > MAX_REFERENCE_IMAGE_BYTES) {
    return {
      ok: false,
      error: {
        error: "reference_image_too_large",
        field: "referenceImage",
        message: "Reference image must be 5 MB or less.",
      },
    };
  }

  const contentType = value.type.toLowerCase();
  if (!REFERENCE_IMAGE_TYPES.has(contentType)) {
    return {
      ok: false,
      error: {
        error: "invalid_reference_image_type",
        field: "referenceImage",
        message: "Reference image must be PNG, JPEG, or WebP.",
      },
    };
  }

  const buffer = Buffer.from(await value.arrayBuffer());
  try {
    await sharp(buffer).metadata();
  } catch {
    return {
      ok: false,
      error: {
        error: "invalid_reference_image",
        field: "referenceImage",
        message: "Reference image must be a readable image.",
      },
    };
  }

  return {
    ok: true,
    image: {
      fileName: sanitizeFileName(value.name),
      contentType,
      sizeBytes: buffer.byteLength,
      buffer,
    },
  };
}

function stringField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function sanitizeFileName(value: string): string {
  const name = value.trim().replace(/[\\/]+/g, "-");
  return name.slice(0, 120) || "reference-image";
}

function hashGenerationRequest(
  body: CreatePetGenerationRequestInput,
  referenceImage: CreateGenerationRequestImageInput | null,
): string {
  return hashIdempotencyPayload({
    body: {
      ...body,
      contactEmail: body.contactEmail.toLowerCase(),
    },
    referenceImage: referenceImage
      ? {
          fileName: referenceImage.fileName,
          contentType: referenceImage.contentType,
          sizeBytes: referenceImage.sizeBytes,
          sha256: hashBuffer(referenceImage.buffer),
        }
      : null,
  });
}

function idempotencyRouteScope(
  route: string,
  principal: { userId: string } | null,
): string {
  return `${route}#${principal ? `user:${principal.userId}` : "anonymous"}`;
}
