import {PublicPreviewError, readApprovedPetPreview} from "@/lib/pets/public-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = {params: Promise<{slug: string}>};
async function respond(request: Request, context: Context, head: boolean) {
  try {
    const {slug} = await context.params;
    const {bytes, etag} = await readApprovedPetPreview(slug);
    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": "public, no-cache, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    };
    const matches = request.headers.get("if-none-match")?.split(",").some(value => {
      const tag = value.trim().replace(/^W\//, "");
      return tag === "*" || tag === etag;
    });
    if (matches) return new Response(null, {status:304, headers});
    return new Response(head ? null : new Uint8Array(bytes), {headers:{...headers,"Content-Length":String(bytes.length)}});
  } catch (error) {
    const status = error instanceof PublicPreviewError ? error.status : 503;
    return new Response(head ? null : JSON.stringify({error: status === 404 ? "not_found" : "preview_unavailable"}), {
      status, headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff"},
    });
  }
}
export function GET(request: Request, context: Context) {return respond(request, context, false);}
export function HEAD(request: Request, context: Context) {return respond(request, context, true);}
