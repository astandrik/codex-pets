import type { PublicPet } from "@/lib/pets/types";

/**
 * Loads the approved-pets snapshot for a guide page. Guides are marketing
 * content: when the registry is unavailable we still render the page with
 * an empty example list instead of failing the whole request with a 500.
 */
export async function loadGuidePets(
  load: () => Promise<PublicPet[]>,
): Promise<PublicPet[]> {
  try {
    return await load();
  } catch (error) {
    console.error("[guides] failed to load approved pets snapshot", error);
    return [];
  }
}
