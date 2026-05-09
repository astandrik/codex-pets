import { notFound } from "next/navigation";
import { Button } from "@gravity-ui/uikit";

import { PetDeleteAction } from "@/components/PetDeleteAction/PetDeleteAction";
import { StatePreview } from "@/components/StatePreview/StatePreview";
import { withBasePath } from "@/lib/base-path";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PetPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function PetPage({ params }: PetPageProps) {
  const { slug } = await params;
  const principal = await getCurrentPrincipal();
  const pet = await getPetBySlug(slug);
  if (!pet) notFound();
  if (pet.status === "deleted") notFound();

  const statusSummary = getStatusSummary(pet.status);
  const petJsonUrl = toPublicAssetUrl(pet.petJsonUrl);
  const spritesheetUrl = toPublicAssetUrl(pet.spritesheetUrl);
  const canOwnerDelete = Boolean(principal && pet.ownerId && principal.userId === pet.ownerId);
  const canAdminDelete = Boolean(principal && isAdminUser(principal));

  return (
    <main className="wrap">
      <section className="pet-detail">
        <div>
          <div className="pet-detail__meta">
            <p className="pill">{pet.kind}</p>
            {pet.status !== "approved" ? (
              <p className="pill">{statusSummary.label}</p>
            ) : null}
          </div>
          <h1>{pet.displayName}</h1>
          <p className="lead">
            {pet.description}
            {pet.status !== "approved" ? ` ${statusSummary.message}` : ""}
          </p>
          <div className="pet-detail__actions">
            <Button
              view="action"
              href={withBasePath(`/api/pets/${pet.slug}/download`)}
            >
              Download ZIP
            </Button>
            <Button view="outlined" href={petJsonUrl} target="_blank">
              pet.json
            </Button>
            <Button view="outlined" href={spritesheetUrl} target="_blank">
              spritesheet
            </Button>
            {canAdminDelete ? (
              <PetDeleteAction petId={pet.id} mode="admin" />
            ) : canOwnerDelete ? (
              <PetDeleteAction petId={pet.id} mode="owner" />
            ) : null}
          </div>
          <pre>{`npx petdex install ${pet.slug}`}</pre>
        </div>
        <StatePreview spritesheetUrl={spritesheetUrl} />
      </section>
    </main>
  );
}

function getStatusSummary(status: "approved" | "pending" | "rejected" | "deleted"): {
  label: string;
  message: string;
} {
  if (status === "pending") {
    return {
      label: "Pending review",
      message:
        "This pet exists and can be previewed, but it is not listed publicly until moderation is complete.",
    };
  }

  if (status === "rejected") {
    return {
      label: "Rejected",
      message:
        "This pet is not listed in the public gallery because moderation rejected it.",
    };
  }

  if (status === "deleted") {
    return {
      label: "Deleted",
      message: "This pet has been deleted by its owner.",
    };
  }

  return {
    label: "Approved",
    message: "",
  };
}

function toPublicAssetUrl(value: string): string {
  return value.startsWith("/") ? withBasePath(value) : value;
}
