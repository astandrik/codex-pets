import { normalizeEmail } from "@/lib/auth/repository";
import type { PetKind } from "@/lib/pets/types";
import {
  normalizeKind,
  type ValidationResult,
} from "@/lib/pets/validation";

export type CreatePetGenerationRequestInput = {
  contactEmail: string;
  requesterName: string | null;
  displayNameHint: string | null;
  prompt: string;
  kind: PetKind;
};

const MAX_NAME_LENGTH = 80;
const MAX_PROMPT_LENGTH = 2_000;
const MAX_ADMIN_NOTE_LENGTH = 1_000;
const MAX_LOOKUP_LENGTH = 120;

export function validateCreatePetGenerationRequest(
  value: unknown,
): ValidationResult<CreatePetGenerationRequestInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: "invalid_request_json",
      message: "Request body must be a JSON object.",
    };
  }

  const record = value as Record<string, unknown>;
  const contactEmail = readRequiredEmail(record.contactEmail);
  if (!contactEmail.ok) return contactEmail;

  const prompt = readRequiredString(record.prompt, "prompt");
  if (!prompt.ok) return prompt;
  if (prompt.value.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error: "prompt_too_long",
      field: "prompt",
      message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or less.`,
    };
  }

  return {
    ok: true,
    value: {
      contactEmail: contactEmail.value,
      requesterName: readOptionalText(record.requesterName, MAX_NAME_LENGTH),
      displayNameHint: readOptionalText(record.displayNameHint, MAX_NAME_LENGTH),
      prompt: prompt.value,
      kind: normalizeKind(record.kind),
    },
  };
}

export function readGenerationRequestAdminNote(value: unknown): string | null {
  return readOptionalText(value, MAX_ADMIN_NOTE_LENGTH);
}

export function validatePetLookup(value: unknown): ValidationResult<string> {
  const lookup = readRequiredString(value, "petLookup");
  if (!lookup.ok) return lookup;
  if (lookup.value.length > MAX_LOOKUP_LENGTH) {
    return {
      ok: false,
      error: "pet_lookup_too_long",
      field: "petLookup",
      message: `Pet lookup must be ${MAX_LOOKUP_LENGTH} characters or less.`,
    };
  }
  return lookup;
}

function readRequiredEmail(value: unknown): ValidationResult<string> {
  const text = readRequiredString(value, "contactEmail");
  if (!text.ok) return text;

  const normalized = normalizeEmail(text.value);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid_contact_email",
      field: "contactEmail",
      message: "Contact email must be a valid email address.",
    };
  }

  return { ok: true, value: normalized.email };
}

function readRequiredString(
  value: unknown,
  field: "contactEmail" | "prompt" | "petLookup",
): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      error: "missing_field",
      field,
      message: `${field} is required.`,
    };
  }
  return { ok: true, value: value.trim() };
}

function readOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
