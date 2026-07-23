import { deletePetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { deletePetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";

type SearchIndexRemovers = {
  removeEmbeddings: (slug: string) => Promise<void>;
  removeCaptions: (slug: string) => Promise<void>;
};

export async function deletePetSearchIndexBestEffort(
  slug: string,
  removers: SearchIndexRemovers = {
    removeEmbeddings: deletePetSearchEmbeddings,
    removeCaptions: deletePetSearchCaptions,
  },
): Promise<boolean> {
  const results = await Promise.allSettled([
    removers.removeEmbeddings(slug),
    removers.removeCaptions(slug),
  ]);
  if (results.every((result) => result.status === "fulfilled")) return true;

  console.warn("[codex-pets][pet-search-index]", {
    operation: "delete",
    status: "failed",
  });
  return false;
}
