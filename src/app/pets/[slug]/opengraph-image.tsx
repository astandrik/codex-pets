import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import sharp from "sharp";

import { readPetAssetFile } from "@/lib/pets/assets-repository";
import { getPetBySlug } from "@/lib/pets/repository";
import { PET_SHEET, type ApprovalStatus } from "@/lib/pets/types";
import { SITE_NAME, SOCIAL_IMAGE } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = "Codex pet preview";
export const size = {
  width: SOCIAL_IMAGE.width,
  height: SOCIAL_IMAGE.height,
};
export const contentType = "image/png";

type PetOpenGraphImageProps = {
  params: Promise<{ slug: string }>;
};

type AssetRef = {
  assetId: string;
  filename: string;
};

const MAX_TITLE_LENGTH = 34;
const MAX_DESCRIPTION_LENGTH = 118;
const MAX_OWNER_LENGTH = 34;

export default async function Image({ params }: PetOpenGraphImageProps) {
  const { slug } = await params;
  const pet = await getPetBySlug(slug);

  if (!pet || pet.status === "deleted") {
    notFound();
  }

  const frameDataUrl = await getSpriteFrameDataUrl(pet.spritesheetUrl).catch(
    (error) => {
      console.error("[codex-pets][pet-og-image]", {
        slug: pet.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    },
  );
  const title = truncateText(pet.displayName, MAX_TITLE_LENGTH);
  const description = truncateText(pet.description, MAX_DESCRIPTION_LENGTH);
  const owner = pet.ownerName
    ? `by ${truncateText(pet.ownerName, MAX_OWNER_LENGTH)}`
    : "community pet pack";
  const titleFontSize = getTitleFontSize(title);
  const tags = pet.tags.slice(0, 3);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#111418",
          color: "#f8fafc",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "linear-gradient(135deg, #111418 0%, #182028 48%, #14241d 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            display: "flex",
            width: "100%",
            height: 12,
            background: "#ffbd4a",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 690,
            paddingLeft: 72,
            paddingRight: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              width: "auto",
              marginBottom: 28,
              padding: "12px 18px",
              borderRadius: 999,
              background: "rgba(255, 189, 74, 0.16)",
              color: "#ffcf75",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              display: "flex",
              marginBottom: 18,
              color: "#ffbd4a",
              fontSize: 30,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0,
            }}
          >
            {pet.kind} pet pack
          </div>
          <div
            style={{
              display: "flex",
              fontSize: titleFontSize,
              lineHeight: 0.96,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              color: "#d7dee8",
              fontSize: 30,
              lineHeight: 1.3,
              width: 630,
            }}
          >
            {description}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 28,
              color: "#9da8b6",
              fontSize: 24,
              lineHeight: 1.2,
            }}
          >
            {owner}
            {pet.status !== "approved" ? ` · ${statusLabel(pet.status)}` : ""}
          </div>
          {tags.length ? (
            <div
              style={{
                display: "flex",
                marginTop: 26,
              }}
            >
              {tags.map((tag) => (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    marginRight: 10,
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "#cad2dd",
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  #{truncateText(tag, 18)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            right: 70,
            top: 62,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 410,
            height: 500,
            borderRadius: 42,
            background: "#f8fafc",
            boxShadow: "0 30px 90px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 18,
              display: "flex",
              borderRadius: 30,
              border: "2px solid rgba(17, 20, 24, 0.08)",
            }}
          />
          {frameDataUrl ? (
            <img
              src={frameDataUrl}
              alt=""
              width={384}
              height={416}
              style={{
                objectFit: "contain",
                imageRendering: "pixelated",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 270,
                height: 270,
                borderRadius: 34,
                background: "#ffbd4a",
                color: "#111418",
                fontSize: 150,
                fontWeight: 900,
              }}
            >
              {title.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}

async function getSpriteFrameDataUrl(
  spritesheetUrl: string,
): Promise<string | null> {
  const assetRef = parseAssetRef(spritesheetUrl);
  if (!assetRef) return null;

  const asset = await readPetAssetFile(assetRef);
  const frameBuffer = await sharp(asset.buffer)
    .extract({
      left: 0,
      top: 0,
      width: PET_SHEET.cellWidth,
      height: PET_SHEET.cellHeight,
    })
    .resize({
      width: 384,
      height: 416,
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return `data:image/png;base64,${frameBuffer.toString("base64")}`;
}

function parseAssetRef(value: string): AssetRef | null {
  const pathname = getPathname(value);
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/(spritesheet\.(?:webp|png))$/,
  );
  if (!match) return null;

  return {
    assetId: decodeURIComponent(match[1]),
    filename: match[2],
  };
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

function getTitleFontSize(title: string): number {
  if (title.length > 28) return 56;
  if (title.length > 20) return 68;
  if (title.length > 13) return 78;
  return 92;
}

function statusLabel(status: ApprovalStatus): string {
  if (status === "pending") return "pending review";
  if (status === "rejected") return "rejected";
  return "approved";
}
