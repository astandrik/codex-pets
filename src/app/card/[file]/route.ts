import { NextResponse } from "next/server";
import sharp from "sharp";

import { readSafeCardSlug } from "@/lib/pets/agent-dto";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { getApprovedPetBySlug } from "@/lib/pets/repository";
import {
  readPetAnimationState,
  readSpriteScale,
  renderAnimatedSpriteGif,
  spriteDimensions,
  type PetAnimationState,
} from "@/lib/pets/sprite-rendering";
import { PET_SHEET, type PublicPet } from "@/lib/pets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARD_WIDTH = 640;
const CARD_HEIGHT = 360;
type CardMode = "card" | "sprite";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const slug = readSafeCardSlug(file);
  if (!slug) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = readCardMode(url.searchParams.get("mode"));
  const state = readPetAnimationState(url.searchParams.get("state"));
  const scale = readSpriteScale(url.searchParams.get("scale"));

  try {
    const body =
      mode === "card"
        ? await renderAnimatedCard(pet, state)
        : await renderAnimatedSpriteGif({ pet, state, scale });
    const sprite = spriteDimensions(scale);

    return new Response(new Uint8Array(body), {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "image/gif",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        ...(mode === "sprite"
          ? {
              "X-Codex-Pet-Height": String(sprite.height),
              "X-Codex-Pet-Width": String(sprite.width),
            }
          : {}),
      },
    });
  } catch (error) {
    console.error("[codex-pets][card-route]", {
      slug: pet.slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "card_unavailable" }, { status: 500 });
  }
}

async function renderAnimatedCard(
  pet: PublicPet,
  state: PetAnimationState,
): Promise<Buffer> {
  const assetId = assetIdFromSpritesheetUrl(pet.spritesheetUrl);
  if (!assetId) {
    throw new Error("Unsupported spritesheet URL.");
  }

  const asset = await readPetSpritesheetAsset({ assetId });
  const frames = await Promise.all(
    Array.from({ length: state.frames }, (_, frame) =>
      renderCardFrame({ pet, spritesheet: asset.buffer, frame, state }),
    ),
  );

  return sharp(frames, { join: { animated: true } })
    .gif({
      delay: Array.from({ length: state.frames }, () => 140),
      dither: 0,
      effort: 6,
      keepDuplicateFrames: true,
      loop: 0,
    })
    .toBuffer();
}

async function renderCardFrame(input: {
  pet: PublicPet;
  spritesheet: Buffer;
  frame: number;
  state: PetAnimationState;
}): Promise<Buffer> {
  const sprite = await sharp(input.spritesheet)
    .extract({
      left: input.frame * PET_SHEET.cellWidth,
      top: input.state.row * PET_SHEET.cellHeight,
      width: PET_SHEET.cellWidth,
      height: PET_SHEET.cellHeight,
    })
    .resize({
      width: 176,
      height: 190,
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const title = truncateText(input.pet.displayName, 34);
  const author = `by ${truncateText(input.pet.ownerName ?? "Anonymous", 34)}`;
  const tags = input.pet.tags
    .slice(0, 3)
    .map((tag) => `#${truncateText(tag, 16)}`);
  const tagText = tags.length > 0 ? tags.join("   ") : "Codex pet pack";

  return sharp(
    Buffer.from(
    `
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#171c22"/>
      <stop offset="0.55" stop-color="#162027"/>
      <stop offset="1" stop-color="#13231c"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" rx="0" fill="#111418"/>
  <rect x="0" y="0" width="640" height="360" fill="url(#bg)"/>
  <rect x="28" y="28" width="584" height="304" rx="22" fill="#1d242c" stroke="#3b4652"/>
  <rect x="392" y="52" width="218" height="232" rx="24" fill="#f8fafc"/>
  <rect x="406" y="66" width="190" height="204" rx="18" fill="#e7edf5"/>
  <text x="56" y="74" fill="#ffcf75" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="800">Companion Gallery</text>
  <text x="56" y="132" fill="#f8fafc" font-family="DejaVu Sans, sans-serif" font-size="${titleFontSize(title)}" font-weight="900">${escapeXml(title)}</text>
  <text x="58" y="172" fill="#cad2dd" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="600">${escapeXml(author)}</text>
  <text x="58" y="220" fill="#9da8b6" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="700">${escapeXml(tagText)}</text>
  <rect x="56" y="268" width="272" height="38" rx="19" fill="#322d20" stroke="#6a562d"/>
  <text x="74" y="293" fill="#ffcf75" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="800">Codex-compatible · validated</text>
</svg>`,
    ),
  )
    .composite([{ input: sprite, left: 414, top: 72 }])
    .png()
    .toBuffer();
}

function readCardMode(value: string | null): CardMode {
  return value === "card" ? "card" : "sprite";
}

function assetIdFromSpritesheetUrl(value: string): string | null {
  const pathname = getPathname(value);
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function getPathname(value: string): string {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function titleFontSize(title: string): number {
  if (title.length > 27) return 30;
  if (title.length > 20) return 36;
  return 42;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;");
}
