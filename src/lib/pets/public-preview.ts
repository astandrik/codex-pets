import { createHash } from "node:crypto";
import sharp from "sharp";

import { BASE_PATH, getPublicOrigin } from "@/lib/base-path";
import { isYdbConfigured } from "@/lib/ydb/client";
import { PetAssetNotFoundError } from "./asset-errors";
import { getPetAssetRefFromSpritesheetUrl } from "./asset-urls";
import { readPetSpritesheetAsset } from "./assets-repository";
import { isMockPetsDataSource } from "./mock-data";
import { parsePublicPetLookupSlug } from "./public-slug";
import { getPetBySlug } from "./repository";
import { inferSpriteVersionNumber, PET_SHEETS } from "./types";

export class PublicPreviewError extends Error {
  constructor(readonly status: 404 | 409 | 422 | 503) {
    super("Pet preview unavailable");
    this.name = "PublicPreviewError";
  }
}

function isAnimatedPng(source: Buffer): boolean {
  // libvips exposes only the default APNG image, without metadata.pages.
  for (let offset = 8; offset < source.length;) {
    if (source.length - offset < 12) throw new PublicPreviewError(422);
    const length = source.readUInt32BE(offset);
    if (length > source.length - offset - 12) throw new PublicPreviewError(422);
    const type = source.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset += length + 12;
  }
  throw new PublicPreviewError(422);
}

export async function renderPetPoster(source: Buffer): Promise<Buffer> {
  try {
    const image = sharp(source, {
      limitInputPixels: PET_SHEETS[2].width * PET_SHEETS[2].height,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width || !metadata.height ||
      !inferSpriteVersionNumber(metadata.width, metadata.height) ||
      !["png", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) !== 1 ||
      (metadata.format === "png" && isAnimatedPng(source))
    ) {
      throw new PublicPreviewError(422);
    }
    // Cropping a lazy decoder can skip corruption below the requested cell.
    const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = await sharp(decoded.data, { raw: decoded.info })
      .extract({ left: 0, top: 0, width: 192, height: 208 })
      .raw().toBuffer({ resolveWithObject: true });
    let visible = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) { visible = true; break; }
    }
    if (!visible) throw new PublicPreviewError(422);
    return await sharp(data, { raw: info }).webp({ lossless: true }).toBuffer();
  } catch (error) {
    if (error instanceof PublicPreviewError) throw error;
    throw new PublicPreviewError(422);
  }
}

export async function readApprovedPetPreview(
  slug: string,
): Promise<{ bytes: Buffer; etag: string }> {
  if (!parsePublicPetLookupSlug(slug) || slug.trim() !== slug) throw new PublicPreviewError(404);
  if (!isMockPetsDataSource() && !isYdbConfigured()) throw new PublicPreviewError(503);
  try {
    const pet = await getPetBySlug(slug);
    if (!pet || pet.status !== "approved") throw new PublicPreviewError(404);
    const origin = getPublicOrigin();
    const url = new URL(pet.spritesheetUrl, origin);
    const storedRelativePath = pet.spritesheetUrl.startsWith("/") && !pet.spritesheetUrl.startsWith("//");
    if (BASE_PATH && !storedRelativePath && !url.pathname.startsWith(`${BASE_PATH}/api/assets/`)) {
      throw new PublicPreviewError(422);
    }
    // Stored asset paths are root-relative even when the website has a base path.
    const directAssetPath = storedRelativePath && url.pathname.startsWith("/api/assets/");
    const pathname = !directAssetPath && BASE_PATH && url.pathname.startsWith(`${BASE_PATH}/`)
      ? url.pathname.slice(BASE_PATH.length)
      : url.pathname;
    if (url.origin !== origin || !pathname.startsWith("/api/assets/")) {
      throw new PublicPreviewError(422);
    }
    const reference = getPetAssetRefFromSpritesheetUrl(pathname);
    if (!reference) throw new PublicPreviewError(422);
    const asset = await readPetSpritesheetAsset({ assetId: reference.assetId });
    const bytes = await renderPetPoster(asset.buffer);
    // Cached bytes or a conditional request must never bypass current publication state.
    const current = await getPetBySlug(slug);
    if (!current || current.status !== "approved") throw new PublicPreviewError(404);
    if (current.id !== pet.id || current.spritesheetUrl !== pet.spritesheetUrl) {
      throw new PublicPreviewError(409);
    }
    return { bytes, etag: `"${createHash("sha256").update(bytes).digest("hex")}"` };
  } catch (error) {
    if (error instanceof PublicPreviewError) throw error;
    if (error instanceof PetAssetNotFoundError) throw new PublicPreviewError(404);
    throw new PublicPreviewError(503);
  }
}
