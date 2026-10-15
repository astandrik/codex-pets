export type RelatedPetAnnotationOverride = {
  reason: string;
  entity?: string | null;
  aliases?: readonly string[];
  franchises?: readonly string[];
  franchiseFamilies?: readonly string[];
  collections?: readonly string[];
  specificArchetypes?: readonly string[];
  themes?: readonly string[];
  mediaOrigins?: readonly string[];
};

export const RELATED_PETS_ANNOTATION_CONTROL_REVISION: string;
export const RELATED_PETS_ANNOTATION_ALIASES: Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
export const RELATED_PETS_ANNOTATION_OVERRIDES: Readonly<
  Record<string, Readonly<RelatedPetAnnotationOverride>>
>;
