export function resolveMetadataMaxAttempts(value = 3) {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error("metadata_max_attempts_invalid");
  }
  return value;
}

export function loadMetadataMaxAttempts(environment = process.env) {
  const value = environment.PET_METADATA_MAX_ATTEMPTS;
  if (value === undefined) return 3;
  if (!/^[123]$/.test(value)) {
    throw new Error("metadata_max_attempts_invalid");
  }
  return resolveMetadataMaxAttempts(Number(value));
}
