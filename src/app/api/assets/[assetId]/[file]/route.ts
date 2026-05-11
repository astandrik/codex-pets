import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  readPetAssetFile,
  readPetSpritesheetAsset,
} from "@/lib/pets/assets-repository";
import { ASSET_CACHE_CONTROL } from "@/lib/pets/asset-urls";
import { PET_SHEET, PET_STATES } from "@/lib/pets/types";

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
    if (file === "preview.webp") {
      const asset = await readPetSpritesheetAsset({ assetId });
      const previewBuffer = await sharp(asset.buffer)
        .extract({
          left: 0,
          top: 0,
          width: PET_SHEET.cellWidth,
          height: PET_SHEET.cellHeight,
        })
        .webp({ lossless: true })
        .toBuffer();

      return new NextResponse(new Uint8Array(previewBuffer), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": ASSET_CACHE_CONTROL,
        },
      });
    }

    if (file === "idle-strip.webp") {
      const asset = await readPetSpritesheetAsset({ assetId });
      const idleState = PET_STATES[0];
      const stripBuffer = await sharp(asset.buffer)
        .extract({
          left: 0,
          top: idleState.row * PET_SHEET.cellHeight,
          width: idleState.frames * PET_SHEET.cellWidth,
          height: PET_SHEET.cellHeight,
        })
        .webp({ lossless: true })
        .toBuffer();

      return new NextResponse(new Uint8Array(stripBuffer), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": ASSET_CACHE_CONTROL,
        },
      });
    }

    const asset = await readPetAssetFile({ assetId, filename: file });
    return new NextResponse(new Uint8Array(asset.buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": ASSET_CACHE_CONTROL,
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
