import Link from "next/link";
import { MyPetActions } from "@/components/MyPetActions/MyPetActions";
import { PetCard } from "@/components/PetCard/PetCard";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { listPetsForOwner } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MyPetsPage() {
  const principal = await getCurrentPrincipal();
  const pets = principal ? await listPetsForOwner(principal.userId) : [];

  return (
    <main className="wrap">
      <section>
        <p className="pill">Account</p>
        <h1>My pets</h1>
        <p className="lead">
          Track pending, approved, and rejected packages submitted from your
          account.
        </p>
      </section>

      {!principal ? (
        <div className="empty-state">
          Sign in to see submissions that are attached to your account.
          <p>
            <Link href="/login">Login</Link> or{" "}
            <Link href="/register">create an account</Link>.
          </p>
        </div>
      ) : pets.length > 0 ? (
        <div className="grid">
          {pets.map((pet) => (
            <div key={pet.slug} className="my-pets__item">
              <PetCard pet={pet} showStatus />
              <MyPetActions petId={pet.id} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">You have not submitted pets yet.</div>
      )}
    </main>
  );
}
