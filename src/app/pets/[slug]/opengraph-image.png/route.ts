import Image from "../opengraph-image";
import { toBufferedPngResponse } from "@/lib/og/response";

export const runtime = "nodejs";
export const revalidate = 86400;

type PetOpenGraphPngRouteProps = {
  params: Promise<unknown>;
};

export async function GET(
  _req: Request,
  { params }: PetOpenGraphPngRouteProps,
): Promise<Response> {
  const routeParams = await params;
  const slug =
    routeParams &&
    typeof routeParams === "object" &&
    "slug" in routeParams &&
    typeof routeParams.slug === "string"
      ? routeParams.slug
      : null;

  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  const image = await Image({ params: Promise.resolve({ slug }) });
  return toBufferedPngResponse(image);
}
