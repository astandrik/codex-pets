import { TypedValues, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

const ASSET_CONTENT_TYPES = new Map<string, string>([
  ["pet.json", "application/json; charset=utf-8"],
  ["spritesheet.webp", "image/webp"],
  ["spritesheet.png", "image/png"],
  ["pet.zip", "application/zip"],
]);

export function assetUrl(assetId: string, filename: string): string {
  return `/api/assets/${assetId}/${filename}`;
}

export async function storePetAssetsInYdb(input: {
  assetId: string;
  petJsonBuffer: Buffer;
  spritesheetBuffer: Buffer;
  zipBuffer: Buffer;
  spritesheetExt: "webp" | "png";
}): Promise<{
  petJsonUrl: string;
  spritesheetUrl: string;
  zipUrl: string;
}> {
  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $asset_id AS Utf8;
DECLARE $pet_json_bytes AS String;
DECLARE $spritesheet_bytes AS String;
DECLARE $zip_bytes AS String;
DECLARE $spritesheet_ext AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.assets}
(asset_id, pet_json_bytes, spritesheet_bytes, zip_bytes, spritesheet_ext, created_at)
VALUES ($asset_id, $pet_json_bytes, $spritesheet_bytes, $zip_bytes, $spritesheet_ext, $created_at);
      `,
      {
        $asset_id: TypedValues.utf8(input.assetId),
        $pet_json_bytes: TypedValues.bytes(input.petJsonBuffer),
        $spritesheet_bytes: TypedValues.bytes(input.spritesheetBuffer),
        $zip_bytes: TypedValues.bytes(input.zipBuffer),
        $spritesheet_ext: TypedValues.utf8(input.spritesheetExt),
        $created_at: TypedValues.utf8(new Date().toISOString()),
      },
    ),
  );

  return {
    petJsonUrl: assetUrl(input.assetId, "pet.json"),
    spritesheetUrl: assetUrl(
      input.assetId,
      `spritesheet.${input.spritesheetExt}`,
    ),
    zipUrl: assetUrl(input.assetId, "pet.zip"),
  };
}

export async function readPetAssetFile(input: {
  assetId: string;
  filename: string;
}): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const contentType = ASSET_CONTENT_TYPES.get(input.filename);
  if (!contentType) {
    throw new Error("Unsupported asset file.");
  }

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $asset_id AS Utf8;
SELECT pet_json_bytes, spritesheet_bytes, zip_bytes, spritesheet_ext
FROM ${TABLES.assets}
WHERE asset_id = $asset_id
LIMIT 1;
      `,
      { $asset_id: TypedValues.utf8(input.assetId) },
    ),
  );

  const row = rowsFromResult(result)[0];
  if (!row) {
    throw new Error("Asset not found.");
  }

  const spritesheetExt = textAt(row, 3) === "png" ? "png" : "webp";
  if (input.filename === "pet.json") {
    return { buffer: bytesAt(row, 0), contentType };
  }
  if (input.filename === "pet.zip") {
    return { buffer: bytesAt(row, 2), contentType };
  }
  if (input.filename === `spritesheet.${spritesheetExt}`) {
    return { buffer: bytesAt(row, 1), contentType };
  }

  throw new Error("Asset variant mismatch.");
}
