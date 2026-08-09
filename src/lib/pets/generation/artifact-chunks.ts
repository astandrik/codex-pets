import { createHash } from "node:crypto";
export const PET_GENERATION_ARTIFACT_CHUNK_BYTES = 4 * 1024 * 1024;
export function chunkGenerationArtifact(buffer: Buffer, chunkBytes = PET_GENERATION_ARTIFACT_CHUNK_BYTES): Buffer[] {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) throw new Error("Artifact chunk size must be a positive integer.");
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkBytes) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkBytes, buffer.length)));
  }
  return chunks.length ? chunks : [Buffer.alloc(0)];
}
export function reassembleGenerationArtifact(input: {
  chunks: readonly Buffer[];
  expectedSize: number;
  expectedSha256: string;
}): Buffer {
  const buffer = Buffer.concat(input.chunks);
  if (buffer.length !== input.expectedSize) throw new Error("Artifact size does not match its metadata.");
  if (sha256(buffer) !== input.expectedSha256) throw new Error("Artifact SHA-256 does not match its metadata.");
  return buffer;
}
export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
