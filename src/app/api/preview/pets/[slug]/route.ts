import { getPetBySlug } from "@/lib/pets/repository";
import {
  createPreviewHeadResponse,
  createPreviewHtmlResponse,
  renderPetPreviewHtml,
} from "@/lib/preview/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewPetRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  request: Request,
  { params }: PreviewPetRouteProps,
): Promise<Response> {
  const pet = await resolvePreviewPet(params);
  if (!pet) {
    return new Response("Not found", { status: 404 });
  }

  const { search } = new URL(request.url);

  return createPreviewHtmlResponse(
    renderPetPreviewHtml(pet, {
      publicPath: `/pets/${pet.slug}${search}`,
    }),
  );
}

export async function HEAD(
  _request: Request,
  { params }: PreviewPetRouteProps,
): Promise<Response> {
  const pet = await resolvePreviewPet(params);
  return createPreviewHeadResponse(pet ? 200 : 404);
}

async function resolvePreviewPet(
  params: PreviewPetRouteProps["params"],
): Promise<{
  slug: string;
  displayName: string;
  description: string;
  kind: "creature" | "object" | "character";
  status: "pending" | "approved" | "rejected" | "deleted";
} | null> {
  const { slug } = await params;
  const pet = await getPetBySlug(slug);

  if (!pet || pet.status === "deleted") {
    return null;
  }

  return {
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    status: pet.status,
  };
}
