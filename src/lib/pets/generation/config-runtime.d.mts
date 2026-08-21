export const PET_GENERATION_DEFAULT_MODEL: "gpt-image-2-2026-04-21";
export const PET_GENERATION_DEFAULT_REVIEW_MODEL: "gpt-5.6-sol";
export const PET_GENERATION_DEFAULT_MAX_IMAGE_CALLS: 15;
export const PET_GENERATION_DEFAULT_ARTIFACT_RETENTION_DAYS: 14;
export const PET_GENERATION_DEFAULT_LEASE_SECONDS: 120;
export const PET_GENERATION_MAX_BASE_REROLLS: 1;
export const PET_GENERATION_MAX_TARGETED_RETRIES: 1;
export type PetGenerationConfig = {
  enabled: boolean;
  model: string;
  reviewModel: string;
  maxImageCalls: number;
  artifactRetentionDays: number;
  leaseSeconds: number;
};
export function getPetGenerationConfig(env?: NodeJS.ProcessEnv): PetGenerationConfig;
