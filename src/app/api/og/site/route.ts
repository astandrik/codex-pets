import { toBufferedPngResponse } from "@/lib/og/response";
import { renderSiteOgImage } from "@/lib/og/site-image";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(): Promise<Response> {
  const image = renderSiteOgImage();
  return toBufferedPngResponse(image);
}
