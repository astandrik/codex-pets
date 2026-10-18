import {createHash} from "node:crypto";
import sharp from "sharp";
import {GenerationError, type GenerationReference} from "@/lib/pets/generation/model";

export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const FORMATS: Record<string, string> = {png: "image/png", jpeg: "image/jpeg", webp: "image/webp"};

function animatedPng(bytes: Buffer): boolean {
  // libvips does not expose APNG frame counts on every supported build.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) break;
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
    offset += length + 12;
  }
  return false;
}

export async function normalizeGenerationReference(bytes: Buffer, contentType: string): Promise<GenerationReference> {
  if (!bytes.length) throw new GenerationError("invalid_reference_image");
  if (bytes.length > MAX_REFERENCE_BYTES) throw new GenerationError("reference_image_too_large");
  if (!Object.values(FORMATS).includes(contentType)) throw new GenerationError("invalid_reference_image");
  try {
    const image = sharp(bytes, {limitInputPixels: 25_000_000, failOn: "warning"});
    const metadata = await image.metadata();
    if (!metadata.format || FORMATS[metadata.format] !== contentType || (metadata.pages ?? 1) !== 1 ||
        (metadata.format === "png" && animatedPng(bytes))) throw new GenerationError("invalid_reference_image");
    const normalized = await image.rotate().resize({width: 1024, height: 1024, fit: "inside", withoutEnlargement: true})
      .toColourspace("srgb").png().toBuffer({resolveWithObject: true});
    if (normalized.data.length > MAX_REFERENCE_BYTES) throw new GenerationError("reference_image_too_large");
    return {bytes: normalized.data, metadata: {
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(normalized.data).digest("hex"),
      width: normalized.info.width, height: normalized.info.height, sizeBytes: normalized.data.length, normalizationVersion: 1,
    }};
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError("invalid_reference_image");
  }
}
