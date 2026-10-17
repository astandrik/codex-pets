import {GenerationError, browserGenerationInputSchema} from "@/lib/pets/generation/model";
import {readGenerationBody, readGenerationJson} from "@/lib/pets/generation/http";
import {normalizeGenerationReference, MAX_REFERENCE_BYTES} from "@/lib/pets/generation/reference-image";

export async function readBrowserGenerationInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mime === "application/json") return {input: await readGenerationJson(request, 16 * 1024), multipart: false};
  if (mime !== "multipart/form-data") throw new GenerationError("invalid_argument");
  const bytes = await readGenerationBody(request, 6 * 1024 * 1024);
  let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), {headers: {"Content-Type": contentType}}).formData(); }
  catch { throw new GenerationError("invalid_argument"); }
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  let file: File | undefined;
  for (const [key, value] of form.entries()) {
    if (seen.has(key)) throw new GenerationError("invalid_argument");
    seen.add(key);
    if (key === "referenceImage") {
      if (typeof value === "string" || value.size === 0) throw new GenerationError("invalid_reference_image");
      if (value.size > MAX_REFERENCE_BYTES) throw new GenerationError("reference_image_too_large");
      file = value;
    } else {
      if (!["prompt", "displayName", "requestId"].includes(key) || typeof value !== "string") throw new GenerationError("invalid_argument");
      fields[key] = value;
    }
  }
  const parsed = browserGenerationInputSchema.safeParse(fields);
  if (!parsed.success || (!parsed.data.prompt && !file)) throw new GenerationError("invalid_argument");
  const reference = file ? await normalizeGenerationReference(Buffer.from(await file.arrayBuffer()), file.type.toLowerCase()) : undefined;
  return {input: parsed.data, reference, multipart: true};
}
