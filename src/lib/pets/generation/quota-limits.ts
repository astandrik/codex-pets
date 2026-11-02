export const IP_DAILY_LIMIT = 100;
export const GLOBAL_DAILY_LIMIT = 2000;
export type GenerationDailyQuotaLimits = {ip: number; global: number};
export const DEFAULT_DAILY_QUOTA_LIMITS: GenerationDailyQuotaLimits = {ip: IP_DAILY_LIMIT, global: GLOBAL_DAILY_LIMIT};
// Preserve the bounds of already-issued receipts. Effective totals are capped separately.
export const MAX_EXTRA_ATTEMPTS = Number.MAX_SAFE_INTEGER - 10;
