import { AdminSubmissionActions } from "@/components/AdminSubmissionActions/AdminSubmissionActions";
import Link from "next/link";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { listPendingPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminSubmissionsPage() {
  const principal = await getCurrentPrincipal();
  const isAdmin = isAdminUser(principal);
  const pets = isAdmin ? await listPendingPets() : [];

  return (
    <main className="wrap">
      <section>
        <p className="pill">Admin</p>
        <h1>Pending submissions</h1>
        <p className="lead">
          Manual queue for approving or rejecting uploaded Codex pet packages.
        </p>
      </section>

      {!principal ? (
        <div className="empty-state">
          Sign in with an admin account to open the moderation queue.
          <p>
            <Link href="/login">Login</Link>
          </p>
        </div>
      ) : !isAdmin ? (
        <div className="empty-state">This account does not have admin access.</div>
      ) : pets.length > 0 ? (
        <div className="admin-list">
          {pets.map((pet) => (
            <article className="admin-list__item panel" key={pet.id}>
              <div>
                <div className="admin-list__meta">
                  <p className="pill">{pet.kind}</p>
                  <Link href={`/pets/${pet.slug}`} className="admin-list__link">
                    Open pet
                  </Link>
                </div>
                <h2>
                  <Link href={`/pets/${pet.slug}`} className="admin-list__title-link">
                    {pet.displayName}
                  </Link>
                </h2>
                <p className="muted">{pet.description}</p>
                <p className="muted">
                  Submitted by {pet.ownerName ?? pet.contactEmail ?? "anonymous"} on{" "}
                  {new Date(pet.createdAt).toLocaleString()}
                </p>
              </div>
              <AdminSubmissionActions petId={pet.id} />
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">No pending submissions.</div>
      )}
    </main>
  );
}
