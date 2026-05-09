import { Button } from "@gravity-ui/uikit";

import { PetCard } from "@/components/PetCard/PetCard";
import { withBasePath } from "@/lib/base-path";
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

  return (
    <main className="wrap">
      <section className="home-hero">
        <div>
          <p className="pill">The Codex pet registry</p>
          <h1>Animated companions for Codex</h1>
          <p className="lead">
            Browse community-made pet packs, preview every animation state, and
            download a ZIP that drops into <code>~/.codex/pets/&lt;slug&gt;</code>.
          </p>
        </div>
        <Button view="action" size="l" href={withBasePath("/submit")}>
          Submit a pet
        </Button>
      </section>

      <section className="section">
        <form className="gallery-filter" action={withBasePath("/")}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, tag, or vibe"
            aria-label="Search pets"
          />
          <select name="kind" defaultValue={kind}>
            <option value="all">All kinds</option>
            <option value="creature">Creatures</option>
            <option value="object">Objects</option>
            <option value="character">Characters</option>
          </select>
          <Button type="submit">Filter</Button>
        </form>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Gallery</h2>
          <span className="muted">{pets.length} approved pets</span>
        </div>
        {pets.length > 0 ? (
          <div className="grid">
            {pets.map((pet) => (
              <PetCard key={pet.slug} pet={pet} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            No approved pets yet. Submitted pets will appear here after
            moderation.
          </div>
        )}
      </section>
    </main>
  );
}
