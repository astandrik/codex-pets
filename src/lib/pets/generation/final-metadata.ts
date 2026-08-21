import type { ValidationResult } from "@/lib/pets/validation";
import { normalizeKind, readTags, slugify } from "@/lib/pets/validation";
import type { PetGenerationFinalMetadata } from "@/lib/pets/generation/types";
export function validateGenerationFinalMetadata(value: unknown): ValidationResult<PetGenerationFinalMetadata> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "invalid_final_metadata", message: "Final metadata must be a JSON object." };
  }
  const record = value as Record<string, unknown>;
  const id = text(record.id, "id", 80);
  if (!id.ok) return id;
  if (!slugify(id.value)) return { ok: false, error: "invalid_pet_id", field: "id", message: "Pet id must contain Latin letters or digits." };
  const displayName = text(record.displayName, "displayName", 80);
  if (!displayName.ok) return displayName;
  const description = text(record.description, "description", 320);
  if (!description.ok) return description;
  if (!Array.isArray(record.tags)) return { ok: false, error: "invalid_tags", field: "tags", message: "tags must be an array of strings." };
  return { ok: true, value: { id: id.value, displayName: displayName.value, description: description.value,
    kind: normalizeKind(record.kind), tags: readTags(record.tags) } };
}
function text(value: unknown, field: "id" | "displayName" | "description", maximum: number): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "missing_field", field, message: `${field} is required.` };
  }
  const normalized = value.trim();
  return normalized.length <= maximum
    ? { ok: true, value: normalized }
    : { ok: false, error: "field_too_long", field, message: `${field} must be ${maximum} characters or less.` };
}
