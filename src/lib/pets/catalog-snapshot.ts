import type { PublicPet } from "@/lib/pets/types";

export const PET_CATALOG_SNAPSHOT_HEADER =
  "X-Codex-Pets-Catalog-Snapshot";
export const PET_CATALOG_RANKING_HEADER =
  "X-Codex-Pets-Catalog-Ranking";

export type ApprovedPetsCatalogSnapshot = {
  pets: PublicPet[];
  version: string;
};
