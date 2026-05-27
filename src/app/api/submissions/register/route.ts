import { NextResponse } from "next/server";

import { jsonApiError, jsonValidationError } from "@/lib/api-error";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/repository";
import { storePetAssetsInYdb } from "@/lib/pets/assets-repository";
import { createPendingPet } from "@/lib/pets/repository";
import { validateUploadedPackage } from "@/lib/pets/package";
import { normalizeKind, readTags } from "@/lib/pets/validation";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
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

  const assetId = `asset_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const assetUrls = await storePetAssetsInYdb({
    assetId,
    petJsonBuffer,
    spritesheetBuffer,
    zipBuffer,
    spritesheetExt,
  });

  const pet = await createPendingPet({
    petJson: validation.value.petJson,
    ownerId: principal?.userId ?? "",
    ownerEmail: principal?.email ?? null,
    ownerName: principal?.name ?? null,
    contactEmail: principal?.email ?? normalizedContactEmail?.email ?? null,
    kind: normalizeKind(formData.get("kind")),
    tags: readTags(
      String(formData.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
    zipUrl: assetUrls.zipUrl,
    petJsonUrl: assetUrls.petJsonUrl,
    spritesheetUrl: assetUrls.spritesheetUrl,
    spritesheetExt,
  });

  return NextResponse.json({ ok: true, pet }, { status: 201 });
}
