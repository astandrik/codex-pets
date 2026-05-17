import { NextResponse } from "next/server";
import sharp from "sharp";

import { getCurrentPrincipal } from "@/lib/auth/session";
import {
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
  const principal = await getCurrentPrincipal();
  if (!isYdbConfigured() && !isMockPetsDataSource()) {
    return NextResponse.json(
      { error: "service_not_configured" },
      { status: 503 },
    );
  }

  const parsed = await readRequestBody(req);
  if (!parsed.ok) return parsed.response;

  const validation = validateCreatePetGenerationRequest(parsed.body);
  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }

  const request = await createGenerationRequest({
    ...validation.value,
    requesterUserId: principal?.userId ?? null,
    referenceImage: parsed.referenceImage,
  });

  return NextResponse.json(
    {
      ok: true,
      request: {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
      },
    },
    { status: 201 },
  );
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
      response: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
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
      response: NextResponse.json(
        { error: "invalid_form_data" },
        { status: 400 },
      ),
    };
  }

  const image = formData.get("referenceImage");
  const referenceImage = image
    ? await readReferenceImage(image)
    : { ok: true as const, image: null };
  if (!referenceImage.ok) {
    return {
      ok: false,
      response: NextResponse.json(referenceImage.error, { status: 400 }),
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
