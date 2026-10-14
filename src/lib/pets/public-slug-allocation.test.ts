import { describe, expect, it, vi } from "vitest";
import { findAvailablePublicPetSlug, PublicPetSlugUnavailableError } from "./public-slug-allocation";

describe("bounded public slug allocation", () => {
  it("uses the first free numeric suffix, preserving the length limit", async () => {
    const base = "a".repeat(64);
    const listTaken = vi.fn(async (candidates: string[]) => candidates.slice(0, 3));
    expect(await findAvailablePublicPetSlug(base, listTaken)).toEqual({ available: false, suggestedSlug: `${"a".repeat(62)}-4` });
    const candidates = listTaken.mock.calls[0][0];
    expect(candidates.length).toBeLessThanOrEqual(104);
    expect(candidates.every(slug => slug.length <= 64)).toBe(true);
  });
  it("uses bounded random fallback after numeric candidates are exhausted", async () => {
    expect(await findAvailablePublicPetSlug("lumi", async slugs => slugs.slice(0, 99), { randomSuffix: () => "fallback" })).toEqual({ available: false, suggestedSlug: "lumi-fallback" });
    await expect(findAvailablePublicPetSlug("lumi", async slugs => slugs, { randomSuffix: () => "fallback" })).rejects.toBeInstanceOf(PublicPetSlugUnavailableError);
  });
  it("preserves the classic 48-character base and trailing hyphen behavior", async () => {
    const base = `${"a".repeat(47)}-`;
    expect(await findAvailablePublicPetSlug(base, async () => [], { maxLength: 48 })).toEqual({ available: true, suggestedSlug: base });
    const collision = await findAvailablePublicPetSlug(base, async () => [base], { maxLength: 48 });
    expect(collision.suggestedSlug).toBe(`${"a".repeat(46)}-2`);
  });
});
