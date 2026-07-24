import { describe, expect, it } from "vitest";

import {
  approvedPetsCatalogQuery,
  approvedPetsNewestQuery,
} from "@/lib/pets/repository";

describe("approved pets catalog query", () => {
  it("loads the complete approved catalog in newest-first order", () => {
    const query = approvedPetsCatalogQuery();

    expect(query).toMatch(/WHERE status = \$status/);
    expect(query).toMatch(/ORDER BY created_at DESC/);
    expect(query).not.toMatch(/\bLIMIT\b/i);
  });

  it("keeps the existing 200-item cap outside the search candidate query", () => {
    expect(approvedPetsNewestQuery()).toMatch(/LIMIT 200/);
  });
});
