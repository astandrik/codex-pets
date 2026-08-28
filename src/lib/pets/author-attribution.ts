import type { ValidationResult } from "@/lib/pets/validation";

export const MAX_PUBLIC_AUTHOR_NAME_LENGTH = 80;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function derivePublicAuthorNameFromEmail(
  email: string,
): string | null {
  const localPart = email.trim().split("@", 1)[0]?.trim() ?? "";
  return localPart
    ? localPart.slice(0, MAX_PUBLIC_AUTHOR_NAME_LENGTH)
    : null;
}

export function validatePublicAuthorName(
  value: unknown,
): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      error: "missing_public_author_name",
      field: "publicAuthorName",
      message: "Public author name is required when contact email is provided.",
    };
  }

  const name = value.trim();
  if (name.length > MAX_PUBLIC_AUTHOR_NAME_LENGTH) {
    return {
      ok: false,
      error: "public_author_name_too_long",
      field: "publicAuthorName",
      message: `Public author name must be at most ${MAX_PUBLIC_AUTHOR_NAME_LENGTH} characters.`,
    };
  }
  if (CONTROL_CHARACTER_PATTERN.test(name)) {
    return {
      ok: false,
      error: "invalid_public_author_name",
      field: "publicAuthorName",
      message: "Public author name cannot contain control characters.",
    };
  }

  return { ok: true, value: name };
}
