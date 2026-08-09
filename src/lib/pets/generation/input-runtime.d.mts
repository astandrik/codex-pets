export type NormalizedGenerationReference = {
  buffer: Buffer;
  contentType: "image/png";
  width: number;
  height: number;
};
export function normalizeGenerationReference(input: {
  buffer: Buffer;
  declaredContentType: string;
}): Promise<NormalizedGenerationReference>;
export function detectReferenceImageType(buffer: Buffer): "image/png" | "image/jpeg" | "image/webp" | null;
