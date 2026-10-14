import { describe, expect, it } from "vitest";
import { appendPublicPetSlugSuffix, parsePublicPetLookupSlug, parsePublicPetSlug, suggestPublicPetSlug } from "./public-slug";

describe("human-readable public pet slugs", () => {
  it.each([["Мятня", "myatnya"], ["Ёжик", "yozhik"], ["Йога и чай", "yoga-i-chay"],
    ["Crème brûlée", "creme-brulee"], ["  Café / déjà vu!  ", "cafe-deja-vu"], ["Lumi", "lumi"],
    ["Straße", "strasse"], ["", ""], ["✨🐈✨", ""], ["東京", ""]])("suggests %s as %s", (name, slug) => {
    expect(suggestPublicPetSlug(name)).toBe(slug);
  });
  it("accepts only bounded lowercase ASCII slugs with no edge hyphens", () => {
    for (const value of ["a", "a-1", "a--b", "a".repeat(64)]) expect(parsePublicPetSlug(value)).toBe(value);
    for (const value of ["", "-a", "a-", "A", "a/b", "a_b", "a b", " a", "a ", "пет", "a".repeat(65), null, 4]) {
      expect(parsePublicPetSlug(value)).toBeNull();
    }
  });
  it("reads existing public slugs without relaxing new-slug creation rules", () => {
    for (const value of ["a".repeat(49), "a".repeat(64), "legacy-"]) {
      expect(parsePublicPetLookupSlug(` ${value} `)).toBe(value);
    }
    for (const value of ["", "../pet", "-pet", "a".repeat(65), null, 4]) {
      expect(parsePublicPetLookupSlug(value)).toBeNull();
    }
    expect(parsePublicPetSlug("legacy-")).toBeNull();
    expect(parsePublicPetSlug(" pet ")).toBeNull();
  });
  it("reserves room for suffixes and never leaves an edge hyphen after truncation", () => {
    expect(appendPublicPetSlugSuffix("lumi", "2")).toBe("lumi-2");
    expect(appendPublicPetSlugSuffix("a".repeat(64), "123")).toBe(`${"a".repeat(60)}-123`);
    expect(appendPublicPetSlugSuffix("hello-world", "2", 8)).toBe("hello-2");
    expect(suggestPublicPetSlug(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
    expect(() => appendPublicPetSlugSuffix("lumi", "2", 2)).toThrow();
    expect(() => appendPublicPetSlugSuffix("lumi", "../x")).toThrow();
  });
});
