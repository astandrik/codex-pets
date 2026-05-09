import { NextResponse } from "next/server";

import { readPetAssetFile } from "@/lib/pets/assets-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetRouteProps = {
  params: Promise<{ assetId: string; file: string }>;
};

export async function GET(
  _req: Request,
  { params }: AssetRouteProps,
): Promise<Response> {
  const { assetId, file } = await params;

  try {
    const asset = await readPetAssetFile({ assetId, filename: file });
    return new NextResponse(new Uint8Array(asset.buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("[codex-pets][asset-route]", {
      assetId,
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
