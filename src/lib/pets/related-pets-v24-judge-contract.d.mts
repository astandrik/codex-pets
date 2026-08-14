import type { PetKind } from "./types";

export type RelatedPetsV24JudgePreference = "A" | "B" | "tie";
export type RelatedPetsV24JudgeConfidence = "low" | "medium" | "high";
export type RelatedPetsV24JudgeCard = {
  displayName: string;
  kind: PetKind;
  description: string;
};
export type RelatedPetsV24JudgeResult = {
  slateAGrades: Array<{ position: number; grade: 0 | 1 | 2 | 3 }>;
  slateBGrades: Array<{ position: number; grade: 0 | 1 | 2 | 3 }>;
  preference: RelatedPetsV24JudgePreference;
  top4: RelatedPetsV24JudgePreference;
  top8: RelatedPetsV24JudgePreference;
  confidence: RelatedPetsV24JudgeConfidence;
};

export const RELATED_PETS_V24_JUDGE_REVISION: string;
export const RELATED_PETS_V24_JUDGE_MODEL_NAME: "gpt-oss-120b";
export const RELATED_PETS_V24_JUDGE_SCHEMA_NAME: string;
export const RELATED_PETS_V24_JUDGE_SYSTEM_PROMPT: string;
export const RELATED_PETS_V24_JUDGE_RESPONSE_JSON_SCHEMA: object;
export function buildRelatedPetsV24JudgeInput(input: {
  source: RelatedPetsV24JudgeCard;
  slateA: RelatedPetsV24JudgeCard[];
  slateB: RelatedPetsV24JudgeCard[];
}): string;
export function parseRelatedPetsV24JudgeResult(input: unknown): RelatedPetsV24JudgeResult;
export function swapRelatedPetsV24JudgeResult(input: unknown): RelatedPetsV24JudgeResult;
export function sameRelatedPetsV24JudgeDecision(left: unknown, right: unknown): boolean;
