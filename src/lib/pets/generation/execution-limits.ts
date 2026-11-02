export const DEFAULT_PROVIDER_CALLS = 20;
export const MAX_PROVIDER_CALLS = 22;

export function configuredProviderCalls(fallback = DEFAULT_PROVIDER_CALLS): number {
  const raw = process.env.PET_GENERATION_PROVIDER_CALLS;
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error("Invalid PET_GENERATION_PROVIDER_CALLS");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_PROVIDER_CALLS) throw new Error("Invalid PET_GENERATION_PROVIDER_CALLS");
  return value;
}
