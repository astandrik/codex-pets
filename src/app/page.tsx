import { HomePage } from "@/components/HomePage/HomePage";
import { listApprovedPets } from "@/lib/pets/repository";
import { normalizeKind } from "@/lib/pets/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{ q?: string; kind?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  const q = params.q ?? "";
  const kind = params.kind && params.kind !== "all" ? normalizeKind(params.kind) : "all";
  const pets = await listApprovedPets({ q, kind });

  return <HomePage pets={pets} q={q} kind={kind} />;
}
