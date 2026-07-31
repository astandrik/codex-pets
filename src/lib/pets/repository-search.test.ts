import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approvedPetsCatalogQuery,
  approvedPetsNewestQuery,
  listApprovedPetsForSearch,
} from "@/lib/pets/repository";

describe("approved pets catalog query", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the complete approved catalog in newest-first order", () => {
    const query = approvedPetsCatalogQuery();

    expect(query).toMatch(/WHERE status = \$status/);
    expect(query).toMatch(/ORDER BY created_at DESC, slug ASC/);
    expect(query).not.toMatch(/\bLIMIT\b/i);
  });

  it("keeps the existing 200-item cap outside the search candidate query", () => {
    expect(approvedPetsNewestQuery()).toMatch(/LIMIT 200/);
  });

  it("provides at least three mock catalog pages for local pagination checks", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");

    const pets = await listApprovedPetsForSearch();

    expect(Math.ceil(pets.length / 24)).toBeGreaterThanOrEqual(3);
  });

  it("sorts tied mock pets by slug after newest-first ordering", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");

    const pets = await listApprovedPetsForSearch();

    expect(pets.slice(0, 3).map((pet) => pet.slug)).toEqual([
      "catalog-companion-01",
      "catalog-companion-02",
      "catalog-companion-03",
    ]);
  });

  it("returns lightweight sitemap rows without full public pet shaping", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const repository = await import("@/lib/pets/repository");
    const listSitemapEntries = Reflect.get(
      repository,
      "listApprovedPetSitemapEntries",
    );

    expect(listSitemapEntries).toBeTypeOf("function");
    if (typeof listSitemapEntries !== "function") return;

    const entries = await listSitemapEntries();

    expect(entries.length).toBeGreaterThan(48);
    expect(Object.keys(entries[0] ?? {})).toEqual([
      "slug",
      "createdAt",
      "updatedAt",
      "approvedAt",
    ]);
    expect(entries.slice(0, 3).map((entry: { slug: string }) => entry.slug)).toEqual([
      "catalog-companion-01",
      "catalog-companion-02",
      "catalog-companion-03",
    ]);
  });
});
