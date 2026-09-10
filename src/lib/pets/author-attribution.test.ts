import { describe, expect, it } from "vitest";

import {
  derivePublicAuthorNameFromEmail,
  MAX_PUBLIC_AUTHOR_NAME_LENGTH,
  validatePublicAuthorName,
} from "@/lib/pets/author-attribution";

describe("public author attribution", () => {
  it.each([
    ["person@example.com", "person"],
    ["Mixed.Case@example.com", "Mixed.Case"],
    ["person+codex@example.com", "person+codex"],
  ])("derives the complete local part from %s", (email, expected) => {
    expect(derivePublicAuthorNameFromEmail(email)).toBe(expected);
  });

  it("trims and bounds a derived alias", () => {
    const localPart = "a".repeat(MAX_PUBLIC_AUTHOR_NAME_LENGTH + 20);

    expect(derivePublicAuthorNameFromEmail(`  ${localPart}@example.com  `)).toBe(
      "a".repeat(MAX_PUBLIC_AUTHOR_NAME_LENGTH),
    );
  });

  it.each(["", "   "])("rejects an empty alias", (value) => {
    expect(validatePublicAuthorName(value)).toMatchObject({
      ok: false,
      error: "missing_public_author_name",
    });
  });

  it("accepts and trims a custom alias", () => {
    expect(validatePublicAuthorName("  Microwave Cat  ")).toEqual({
      ok: true,
      value: "Microwave Cat",
    });
  });

  it("rejects aliases over 80 characters and control characters", () => {
    expect(
      validatePublicAuthorName("a".repeat(MAX_PUBLIC_AUTHOR_NAME_LENGTH + 1)),
    ).toMatchObject({ ok: false, error: "public_author_name_too_long" });
    expect(validatePublicAuthorName("safe\nInjected")).toMatchObject({
      ok: false,
      error: "invalid_public_author_name",
    });
  });

  it("does not derive an alias without an email", () => {
    expect(derivePublicAuthorNameFromEmail("")).toBeNull();
  });
});
