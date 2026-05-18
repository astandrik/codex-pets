import { getIndexNowKey, getIndexNowKeyFileName } from "@/lib/indexnow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const key = getIndexNowKey();
  const fileName = getIndexNowKeyFileName();
  const { file } = await params;

  if (!key || !fileName || file !== fileName) {
    return new Response("not found", { status: 404 });
  }

  return new Response(key, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
