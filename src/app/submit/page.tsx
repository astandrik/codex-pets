import { SubmitForm } from "@/components/SubmitForm/SubmitForm";
import { getCurrentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const principal = await getCurrentPrincipal();

  return (
    <main className="wrap">
      <section>
        <p className="pill">Upload</p>
        <h1>Submit a Codex pet</h1>
        <p className="lead">
          Upload a ZIP or the two root files: <code>pet.json</code> and{" "}
          <code>spritesheet.webp</code>/<code>spritesheet.png</code>. New pets
          stay pending until an admin approves them. You can submit
          anonymously or sign in to track your own submissions.
        </p>
      </section>
      <SubmitForm
        isAuthenticated={Boolean(principal)}
        defaultContactEmail={principal?.email ?? null}
      />
    </main>
  );
}
