import { deletePetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";

type DeletePetSearchEmbeddings = (slug: string) => Promise<void>;

export async function deletePetSearchEmbeddingsBestEffort(
  slug: string,
  remove: DeletePetSearchEmbeddings = deletePetSearchEmbeddings,
): Promise<boolean> {
  try {
    await remove(slug);
    return true;
  } catch {
    console.warn("[codex-pets][pet-search-embedding]", {
      operation: "delete",
      status: "failed",
    });
    return false;
  }
}
