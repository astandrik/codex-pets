import {z} from "zod";

export const CARD_METADATA_MAX_ESTIMATED_MICRO_USD = 500_000;
export const CARD_METADATA_POLICY = 1;
export const CARD_METADATA_FALLBACK = "An animated desktop pet created from a saved character reference.";
export const cardMetadataFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(320),
  tags: z.array(z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f<>]+$/u)).max(8),
}).strict();
export const cardMetadataEditSchema=cardMetadataFieldsSchema.extend({revision:z.number().int().nonnegative()});
export type CardMetadataFields = z.infer<typeof cardMetadataFieldsSchema>;
export function normalizeCardMetadata(value:unknown):CardMetadataFields {
  const fields=cardMetadataFieldsSchema.parse(value);
  return cardMetadataFieldsSchema.parse({...(fields.displayName===undefined?{}:{displayName:fields.displayName}),description:fields.description,tags:[...new Set(fields.tags.map(tag=>tag.toLowerCase()))]});
}
export const cardMetadataRecordSchema = z.object({
  policy:z.literal(CARD_METADATA_POLICY),
  state:z.enum(["pending","inflight","completed","failed"]),
  revision:z.number().int().nonnegative().default(0),
  edited:z.boolean().default(false),
  fields:cardMetadataFieldsSchema.optional(),
  requestHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  responseHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  startedAt:z.number().optional(),
  usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),costUsd:z.number().nonnegative()}).optional(),
  error:z.enum(["provider_rejected","outcome_unknown","budget_exhausted","generation_disabled","metadata_unavailable"]).optional(),
});
export type CardMetadataRecord=z.infer<typeof cardMetadataRecordSchema>;
export const publicCardMetadataSchema=cardMetadataFieldsSchema.extend({revision:z.number().int().nonnegative(),editable:z.boolean(),automaticState:z.enum(["pending","inflight","completed","failed","legacy"]),edited:z.boolean()});
export type PublicCardMetadata=z.infer<typeof publicCardMetadataSchema>;
