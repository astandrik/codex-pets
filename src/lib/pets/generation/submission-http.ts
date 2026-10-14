import { jsonApiError } from "@/lib/api-error";
import { GenerationError } from "@/lib/pets/generation/model";
import { GENERATION_HEADERS, generationHttpError, readGenerationJson } from "@/lib/pets/generation/http";

const MAX_BODY_BYTES = 1024;

export async function readSubmissionSlug(request: Request): Promise<string> {
  const body=await readGenerationJson(request,MAX_BODY_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !("slug" in body) || typeof body.slug !== "string") throw new GenerationError("invalid_argument");
  // The service checks the existing immutable receipt before validating a different draft slug.
  return body.slug;
}

export function submissionHttpError(error: unknown): Response {
  if (error instanceof GenerationError && error.code === "public_slug_unavailable") {
    return jsonApiError("public_slug_unavailable", { status: 409,
      message: "This public URL could not be saved. Choose another one and try again.", headers: GENERATION_HEADERS });
  }
  if (error instanceof GenerationError && error.code === "invalid_public_slug") {
    return jsonApiError("invalid_public_slug", { status: 400,
      message: "Use 1–64 lowercase Latin letters, digits or hyphens, without a leading or trailing hyphen.", headers: GENERATION_HEADERS });
  }
  return generationHttpError(error, true);
}

export async function readGeneratedSubmission(request:Request):Promise<{slug:string;metadataRevision?:number}>{
  const body=await readGenerationJson(request,MAX_BODY_BYTES);
  if(!body||typeof body!=="object"||Array.isArray(body)||!("slug"in body)||typeof body.slug!=="string"||Object.keys(body).some(key=>key!=="slug"&&key!=="metadataRevision"))throw new GenerationError("invalid_argument");
  if("metadataRevision"in body){if(typeof body.metadataRevision!=="number"||!Number.isSafeInteger(body.metadataRevision)||body.metadataRevision<0)throw new GenerationError("invalid_argument");return {slug:body.slug,metadataRevision:body.metadataRevision};}
  return {slug:body.slug};
}
