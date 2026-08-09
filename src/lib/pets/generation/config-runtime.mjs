export const PET_GENERATION_DEFAULT_MODEL = "gpt-image-2-2026-04-21";
export const PET_GENERATION_DEFAULT_REVIEW_MODEL = "gpt-5.6-sol";
export const PET_GENERATION_DEFAULT_MAX_IMAGE_CALLS = 15;
export const PET_GENERATION_DEFAULT_ARTIFACT_RETENTION_DAYS = 14;
export const PET_GENERATION_DEFAULT_LEASE_SECONDS = 120;
export const PET_GENERATION_MAX_BASE_REROLLS = 1;
export const PET_GENERATION_MAX_TARGETED_RETRIES = 1;

export function getPetGenerationConfig(env = process.env) {
  return {
    enabled: env.PET_GENERATION_ENABLED?.trim().toLowerCase() === "true",
    model: env.PET_GENERATION_MODEL?.trim() || PET_GENERATION_DEFAULT_MODEL,
    reviewModel: env.PET_GENERATION_REVIEW_MODEL?.trim() || PET_GENERATION_DEFAULT_REVIEW_MODEL,
    maxImageCalls: bounded(env.PET_GENERATION_MAX_IMAGE_CALLS, 15, 1, 15),
    artifactRetentionDays: bounded(env.PET_GENERATION_ARTIFACT_RETENTION_DAYS, 14, 1, 90),
    leaseSeconds: bounded(env.PET_GENERATION_LEASE_SECONDS, 120, 30, 600),
  };
}

function bounded(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
