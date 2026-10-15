import {
  OPENAI_METADATA_MODEL, OPENAI_METADATA_MODEL_URI, OPENAI_ANNOTATION_REVISION,
  OPENAI_ANNOTATION_PROPOSAL_REVISION, OPENAI_CAPTION_REVISION,
} from "@/lib/pets/metadata-sources";
import {
  buildRelatedPetAnnotationInput, buildRelatedPetAnnotationText, createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash, createRelatedPetAnnotationSourceHash,
  getRelatedPetAnnotationProposalContract, listUnresolvedStrongRelations,
  parseRelatedPetAnnotationProposal, resolveRelatedPetAnnotation, type RelatedPetAnnotationInput,
} from "@/lib/pets/related/related-pets-annotation-contract.mjs";
import {
  PET_VISION_SYSTEM_PROMPT, PET_VISION_USER_PROMPT, PET_VISION_RESPONSE_JSON_SCHEMA,
  parsePetVisionCaption, buildPetVisionCaptionText, createPetVisionCaptionEnvelope, createPetVisionCaptionSourceHash,
} from "@/lib/pets/search/search-vision-contract";
import { PET_VISION_FRAME_POLICY, type ExtractedPetVisionFrames } from "@/lib/pets/search/search-vision-frames";
import { METADATA_BUDGET_USD, METADATA_MAX_OUTPUT_TOKENS, metadataHash, metadataReserveUSD, type MetadataRequest } from "@/lib/pets/metadata-worker/ledger";
export type MetadataPet = RelatedPetAnnotationInput & { id: string; status: string };
type Content = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" };

function requestBody(instructions: string, content: Content[], name: string, schema: unknown) {
  return { model: OPENAI_METADATA_MODEL, instructions, input: [{ role: "user", content }],
    reasoning: { effort: "low" }, service_tier: "default", store: false, stream: false,
    max_output_tokens: METADATA_MAX_OUTPUT_TOKENS,
    text: { format: { type: "json_schema", name, strict: true, schema } } };
}

function budgetedRequest(stage: MetadataRequest["stage"], body: ReturnType<typeof requestBody>): MetadataRequest {
  if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 * 1024) throw new Error("metadata_request_too_large");
  const images = body.input[0].content.filter((part) => part.type === "input_image").length;
  // Reserve a deliberately large image allowance for the four small atlas cells. This is an
  // operational buffer, not a claim about the provider's exact vision tokenization.
  const textBody = { ...body, input: [{ ...body.input[0], content: body.input[0].content.map((part) =>
    part.type === "input_image" ? { ...part, image_url: "" } : part) }] };
  const inputTokenBound = Buffer.byteLength(JSON.stringify(textBody)) + 1024 + images * 16_384;
  return { stage, body, inputTokenBound, reservedUSD: metadataReserveUSD(inputTokenBound) };
}

export function prepareApprovalMetadataInputs(pet: MetadataPet, assetId: string, extracted: ExtractedPetVisionFrames) {
  if (!/^pet_[a-zA-Z0-9_-]+$/.test(pet.id) || !pet.slug ||
      !["pending", "approved"].includes(pet.status) || !/^[a-f0-9]{64}$/.test(extracted.spritesheetSha256) ||
      extracted.frames.length !== PET_VISION_FRAME_POLICY.frames.length) {
    throw new Error("metadata_target_mismatch");
  }
  PET_VISION_FRAME_POLICY.frames.forEach((expected, index) => {
    const frame = extracted.frames[index];
    if (frame.state !== expected.state || frame.row !== expected.row || frame.frame !== expected.frame ||
        frame.png.length > 512_000 || frame.dataUrl !== `data:image/png;base64,${frame.png.toString("base64")}`) {
      throw new Error("metadata_frame_invalid");
    }
  });
  const contract = getRelatedPetAnnotationProposalContract(OPENAI_ANNOTATION_PROPOSAL_REVISION);
  const annotation = budgetedRequest("annotation", requestBody(contract.systemPrompt,
    [{ type: "input_text", text: `${contract.userPrompt}\n\n${buildRelatedPetAnnotationInput(pet)}` }], contract.schemaName, contract.schema));
  const caption = budgetedRequest("caption", requestBody(PET_VISION_SYSTEM_PROMPT,
    [{ type: "input_text", text: PET_VISION_USER_PROMPT }, ...extracted.frames.map((frame) =>
      ({ type: "input_image" as const, image_url: frame.dataUrl, detail: "high" as const }))],
    "pet_visual_caption_v1", PET_VISION_RESPONSE_JSON_SCHEMA));
  const totalReserveUSD = annotation.reservedUSD + caption.reservedUSD;
  if (totalReserveUSD > METADATA_BUDGET_USD) throw new Error("metadata_plan_budget_exhausted");
  const contextHash = metadataHash({ petId: pet.id, slug: pet.slug, publicInput: buildRelatedPetAnnotationInput(pet),
    assetId, spritesheetSha256: extracted.spritesheetSha256, framePolicy: PET_VISION_FRAME_POLICY.id,
    modelUri: OPENAI_METADATA_MODEL_URI, annotationRevision: OPENAI_ANNOTATION_REVISION,
    proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION, captionRevision: OPENAI_CAPTION_REVISION,
    requests: [metadataHash(annotation.body), metadataHash(caption.body)] });
  return { annotation, caption, contextHash, totalReserveUSD };
}

export function parseOpenAIAnnotation(value: unknown, slug: string) {
  const proposal = parseRelatedPetAnnotationProposal(value, OPENAI_ANNOTATION_PROPOSAL_REVISION);
  if (listUnresolvedStrongRelations({ slug, proposal }).length) {
    throw new Error("metadata_unresolved_strong_relation");
  }
  return proposal;
}
export const parseOpenAICaption = parsePetVisionCaption;

export function annotationRecord(pet: MetadataPet, proposal: ReturnType<typeof parseOpenAIAnnotation>) {
  const proposalInputHash = createRelatedPetAnnotationProposalInputHash({ pet,
    modelUri: OPENAI_METADATA_MODEL_URI, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION });
  const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
  const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
  return { annotationRevision: OPENAI_ANNOTATION_REVISION, slug: pet.slug,
    sourceHash: createRelatedPetAnnotationSourceHash({ slug: pet.slug, annotationRevision: OPENAI_ANNOTATION_REVISION,
      proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION, proposalInputHash, proposalHash }),
    proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION, proposalInputHash, proposalHash,
    proposalJson: JSON.stringify(proposal), annotationJson: JSON.stringify(annotation),
    annotationText: buildRelatedPetAnnotationText(annotation), updatedAt: new Date().toISOString() };
}

export function captionRecord(pet: MetadataPet, assetId: string, spritesheetSha256: string,
  caption: ReturnType<typeof parseOpenAICaption>) {
  return { captionRevision: OPENAI_CAPTION_REVISION, slug: pet.slug,
    sourceHash: createPetVisionCaptionSourceHash({ captionRevision: OPENAI_CAPTION_REVISION,
      modelUri: OPENAI_METADATA_MODEL_URI, assetId, spritesheetSha256 }),
    captionJson: JSON.stringify(createPetVisionCaptionEnvelope({ assetId, spritesheetSha256, caption })),
    captionText: buildPetVisionCaptionText(caption), updatedAt: new Date().toISOString() };
}
