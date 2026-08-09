import sharp from "sharp";

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_EDGE = 4_096;
const MAX_REFERENCE_PIXELS = 16_000_000;

export async function normalizeGenerationReference(input) {
  if (input.buffer.length === 0 || input.buffer.length > MAX_REFERENCE_BYTES) {
    throw new Error("Reference image must be between 1 byte and 5 MiB.");
  }
  const detected = detectReferenceImageType(input.buffer);
  if (!detected) throw new Error("Reference image must be PNG, JPEG, or WebP.");
  if (normalizeContentType(input.declaredContentType) !== detected) {
    throw new Error("Reference image content type does not match its bytes.");
  }
  const metadata = await sharp(input.buffer, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1 || width > MAX_REFERENCE_EDGE || height > MAX_REFERENCE_EDGE ||
    width * height > MAX_REFERENCE_PIXELS) {
    throw new Error("Reference image exceeds 4096×4096 or 16 megapixels.");
  }
  const normalized = await sharp(input.buffer, { failOn: "error" })
    .rotate()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: normalized.data,
    contentType: "image/png",
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

export function detectReferenceImageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function normalizeContentType(value) {
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
}
