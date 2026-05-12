import JSZip from "jszip";
import sharp from "sharp";

import { assetUrl } from "@/lib/pets/asset-urls";
import { getMockPetByAssetId, type MockPetRecord } from "@/lib/pets/mock-data";
import { PET_SHEET } from "@/lib/pets/types";

type MockAssetFiles = {
  petJsonBuffer: Buffer;
  spritesheetBuffer: Buffer;
  zipBuffer: Buffer;
  spritesheetExt: "webp" | "png";
};

const ASSET_CONTENT_TYPES = new Map<string, string>([
  ["pet.json", "application/json; charset=utf-8"],
  ["spritesheet.webp", "image/webp"],
  ["spritesheet.png", "image/png"],
  ["pet.zip", "application/zip"],
]);

const storedAssetFiles = new Map<string, MockAssetFiles>();
const spritesheetCache = new Map<string, Promise<Buffer>>();
const zipCache = new Map<string, Promise<Buffer>>();

export function storeMockPetAssetFiles(input: {
  assetId: string;
  petJsonBuffer: Buffer;
  spritesheetBuffer: Buffer;
  zipBuffer: Buffer;
  spritesheetExt: "webp" | "png";
}): {
  petJsonUrl: string;
  spritesheetUrl: string;
  zipUrl: string;
} {
  storedAssetFiles.set(input.assetId, {
    petJsonBuffer: Buffer.from(input.petJsonBuffer),
    spritesheetBuffer: Buffer.from(input.spritesheetBuffer),
    zipBuffer: Buffer.from(input.zipBuffer),
    spritesheetExt: input.spritesheetExt,
  });

  return {
    petJsonUrl: assetUrl(input.assetId, "pet.json"),
    spritesheetUrl: assetUrl(
      input.assetId,
      `spritesheet.${input.spritesheetExt}`,
    ),
    zipUrl: assetUrl(input.assetId, "pet.zip"),
  };
}

export async function readMockPetAssetFile(input: {
  assetId: string;
  filename: string;
}): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const storedAsset = storedAssetFiles.get(input.assetId);
  if (storedAsset) {
    return readStoredMockAssetFile(storedAsset, input.filename);
  }

  const pet = getKnownMockPet(input.assetId);

  if (input.filename === "pet.json") {
    return {
      buffer: buildPetJsonBuffer(pet),
      contentType: "application/json; charset=utf-8",
    };
  }

  if (input.filename === "spritesheet.png") {
    return {
      buffer: await renderSpritesheet(pet),
      contentType: "image/png",
    };
  }

  if (input.filename === "pet.zip") {
    return {
      buffer: await buildZip(pet),
      contentType: "application/zip",
    };
  }

  throw new Error("Unsupported mock asset file.");
}

export async function readMockPetSpritesheetAsset(input: {
  assetId: string;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string;
}> {
  const storedAsset = storedAssetFiles.get(input.assetId);
  if (storedAsset) {
    const filename = `spritesheet.${storedAsset.spritesheetExt}`;
    return {
      buffer: Buffer.from(storedAsset.spritesheetBuffer),
      contentType: ASSET_CONTENT_TYPES.get(filename) ?? "image/webp",
      filename,
    };
  }

  const pet = getKnownMockPet(input.assetId);
  return {
    buffer: await renderSpritesheet(pet),
    contentType: "image/png",
    filename: "spritesheet.png",
  };
}

function getKnownMockPet(assetId: string): MockPetRecord {
  const pet = getMockPetByAssetId(assetId);
  if (!pet) {
    throw new Error("Mock asset not found.");
  }
  return pet;
}

function readStoredMockAssetFile(
  asset: MockAssetFiles,
  filename: string,
): {
  buffer: Buffer;
  contentType: string;
} {
  const spritesheetFilename = `spritesheet.${asset.spritesheetExt}`;
  const contentType = ASSET_CONTENT_TYPES.get(filename);
  if (!contentType) {
    throw new Error("Unsupported mock asset file.");
  }

  if (filename === "pet.json") {
    return { buffer: Buffer.from(asset.petJsonBuffer), contentType };
  }
  if (filename === "pet.zip") {
    return { buffer: Buffer.from(asset.zipBuffer), contentType };
  }
  if (filename === spritesheetFilename) {
    return { buffer: Buffer.from(asset.spritesheetBuffer), contentType };
  }

  throw new Error("Mock asset variant mismatch.");
}

function buildPetJsonBuffer(pet: MockPetRecord): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        id: pet.slug,
        displayName: pet.displayName,
        description: pet.description,
        spritesheetPath: "spritesheet.png",
      },
      null,
      2,
    )}\n`,
  );
}

function renderSpritesheet(pet: MockPetRecord): Promise<Buffer> {
  let cached = spritesheetCache.get(pet.assetId);
  if (!cached) {
    cached = sharp(Buffer.from(renderSpritesheetSvg(pet))).png().toBuffer();
    spritesheetCache.set(pet.assetId, cached);
  }
  return cached;
}

function buildZip(pet: MockPetRecord): Promise<Buffer> {
  let cached = zipCache.get(pet.assetId);
  if (!cached) {
    cached = buildZipBuffer(pet);
    zipCache.set(pet.assetId, cached);
  }
  return cached;
}

async function buildZipBuffer(pet: MockPetRecord): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("pet.json", buildPetJsonBuffer(pet));
  zip.file("spritesheet.png", await renderSpritesheet(pet));
  return zip.generateAsync({ type: "nodebuffer" });
}

function renderSpritesheetSvg(pet: MockPetRecord): string {
  const cells: string[] = [];

  for (let row = 0; row < PET_SHEET.rows; row += 1) {
    for (let col = 0; col < PET_SHEET.columns; col += 1) {
      const x = col * PET_SHEET.cellWidth;
      const y = row * PET_SHEET.cellHeight;
      const pulse = 0.64 + ((row + col) % 4) * 0.08;
      const centerY = y + 104 + Math.sin((row + col) / 2) * 10;

      cells.push(`
        <rect x="${x + 10}" y="${y + 10}" width="172" height="188" rx="24" fill="#20252d" opacity="0.94"/>
        <circle cx="${x + 96}" cy="${centerY.toFixed(1)}" r="${(52 * pulse).toFixed(1)}" fill="${pet.color}"/>
        <circle cx="${x + 73}" cy="${y + 88}" r="8" fill="${pet.accent}"/>
        <circle cx="${x + 119}" cy="${y + 88}" r="8" fill="${pet.accent}"/>
        <rect x="${x + 58}" y="${y + 132}" width="76" height="12" rx="6" fill="${pet.accent}" opacity="0.75"/>
      `);
    }
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${PET_SHEET.width}" height="${PET_SHEET.height}" viewBox="0 0 ${PET_SHEET.width} ${PET_SHEET.height}">
  <rect width="100%" height="100%" fill="#111318"/>
  ${cells.join("\n")}
  <text x="48" y="96" fill="#ffffff" font-family="Arial, sans-serif" font-size="54" font-weight="700">${escapeXml(pet.glyph)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
