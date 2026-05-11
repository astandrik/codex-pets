import {
  createPreviewHeadResponse,
  createPreviewHtmlResponse,
  renderSitePreviewHtml,
} from "@/lib/preview/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { search } = new URL(request.url);

  return createPreviewHtmlResponse(
    renderSitePreviewHtml({
      publicPath: search ? `/${search}` : "/",
    }),
  );
}

export async function HEAD(): Promise<Response> {
  return createPreviewHeadResponse();
}
