import { HomePage } from "@/components/HomePage/HomePage";
import { unstable_cache } from "next/cache";
import { listApprovedPets } from "@/lib/pets/repository";
import type { PetKind, PublicPet } from "@/lib/pets/types";

export const runtime = "nodejs";
// Keep request-time rendering because YDB runtime env is only available in the
// running container, then cache the public gallery snapshot explicitly.
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPets(),
  [
    "approved-pets-gallery",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function parseKind(value: string | null): PetKind | "all" {
  if (
    value === "character" ||
    value === "creature" ||
    value === "object"
  ) {
    return value;
  }

  return "all";
}

function matchesFilter(
  pet: PublicPet,
  query: string,
  kind: PetKind | "all",
): boolean {
  if (kind !== "all" && pet.kind !== kind) {
    return false;
  }

  if (!query) {
    return true;
  }

  return (
    pet.displayName.toLowerCase().includes(query) ||
    pet.description.toLowerCase().includes(query) ||
    pet.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const query = firstParam(params?.q)?.trim().toLowerCase() ?? "";
  const kind = parseKind(firstParam(params?.kind));
  const pets = await getApprovedPetsSnapshot();
  const filteredPets = pets.filter((pet) => matchesFilter(pet, query, kind));

  return (
    <HomePage
      pets={pets}
      filteredPets={filteredPets}
      query={query}
      kind={kind}
    />
  );
}
