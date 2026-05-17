import { describe, expect, it } from "vitest";

import {
  validateCreatePetGenerationRequest,
  validatePetLookup,
} from "@/lib/pets/generation-requests";

describe("pet generation request validation", () => {
  it("requires a contact email", () => {
    const result = validateCreatePetGenerationRequest({
      prompt: "Create a small focused helper.",
      kind: "creature",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "missing_field",
      field: "contactEmail",
    });
  });

  it("rejects invalid contact email", () => {
    const result = validateCreatePetGenerationRequest({
      contactEmail: "not-email",
      prompt: "Create a small focused helper.",
      kind: "creature",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_contact_email",
      field: "contactEmail",
    });
  });

  it("rejects empty and oversized prompts", () => {
    expect(validateCreatePetGenerationRequest({
      contactEmail: "user@example.com",
      prompt: " ",
    })).toMatchObject({
      ok: false,
      error: "missing_field",
      field: "prompt",
    });

    expect(validateCreatePetGenerationRequest({
      contactEmail: "user@example.com",
      prompt: "x".repeat(2_001),
    })).toMatchObject({
      ok: false,
      error: "prompt_too_long",
      field: "prompt",
    });
  });

  it("normalizes kind and trims optional text", () => {
    const result = validateCreatePetGenerationRequest({
      contactEmail: " User@Example.com ",
      requesterName: ` ${"A".repeat(90)} `,
      displayNameHint: ` ${"B".repeat(90)} `,
      prompt: "  Create a compact pet.  ",
      kind: "unknown",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        contactEmail: "User@Example.com",
        requesterName: "A".repeat(80),
        displayNameHint: "B".repeat(80),
        prompt: "Create a compact pet.",
        kind: "creature",
      },
    });
  });

  it("validates pet lookup values", () => {
    expect(validatePetLookup(" orbit-otter ")).toEqual({
      ok: true,
      value: "orbit-otter",
    });
    expect(validatePetLookup("x".repeat(121))).toMatchObject({
      ok: false,
      error: "pet_lookup_too_long",
      field: "petLookup",
    });
  });
});
