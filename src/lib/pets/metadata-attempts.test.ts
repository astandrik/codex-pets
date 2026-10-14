import { describe, expect, it } from "vitest";

import { loadMetadataMaxAttempts, resolveMetadataMaxAttempts } from "@/lib/pets/metadata-attempts.mjs";

describe("metadata request attempt limits", () => {
  it("preserves three attempts when the option or env is unset", () => {
    expect(resolveMetadataMaxAttempts()).toBe(3);
    expect(loadMetadataMaxAttempts({})).toBe(3);
  });

  it.each([1, 2, 3])("accepts exactly %s attempts", (value) => {
    expect(resolveMetadataMaxAttempts(value)).toBe(value);
    expect(loadMetadataMaxAttempts({ PET_METADATA_MAX_ATTEMPTS: String(value) })).toBe(value);
  });

  it.each([0, -1, 4, 1.5, NaN, Infinity])("rejects the invalid option %s", (value) => {
    expect(() => resolveMetadataMaxAttempts(value)).toThrow("metadata_max_attempts_invalid");
  });

  it.each(["", "0", "4", "1.5", "NaN", "Infinity", "true", "01", " 1", "1 "])(
    "fails closed for the defined invalid env value %s", (value) => {
      expect(() => loadMetadataMaxAttempts({ PET_METADATA_MAX_ATTEMPTS: value })).toThrow("metadata_max_attempts_invalid");
    },
  );
});
