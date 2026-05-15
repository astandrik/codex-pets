import { NextResponse } from "next/server";

import { createAgentPet, readSafeAgentSlug } from "@/lib/pets/agent-dto";
import { getApprovedPetBySlug } from "@/lib/pets/repository";
import { readSpriteScale, spriteCssValues } from "@/lib/pets/sprite-rendering";
import { PET_STATES } from "@/lib/pets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmbedTheme = "light" | "dark" | "auto";
type EmbedStateKey = "idle" | "running" | "waiting" | "review" | "failed";
type EmbedMode = "card" | "sprite";

type EmbedOptions = {
  mode: EmbedMode;
  theme: EmbedTheme;
  state: (typeof PET_STATES)[number];
  scale: number;
  compact: boolean;
  showInstall: boolean;
  showAuthor: boolean;
  showTags: boolean;
};

const EMBED_STATE_KEYS = new Set<EmbedStateKey>([
  "idle",
  "running",
  "waiting",
  "review",
  "failed",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: rawSlug } = await params;
  const slug = readSafeAgentSlug(rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const agentPet = createAgentPet(pet);
  const options = readEmbedOptions(req);
  const tags = options.showTags ? agentPet.tags.slice(0, 4) : [];
  const sprite = spriteCssValues({
    scale: options.scale,
    state: options.state,
  });
  const spriteStyle = [
    `--pet-row-y:${sprite.rowY}`,
    `--pet-end-x:${sprite.endX}`,
    `--pet-frames:${sprite.frames}`,
    `--pet-duration:${sprite.duration}`,
    `background-image:url('${cssUrl(agentPet.spritesheetUrl)}')`,
  ].join(";");

  return new Response(
    [
      "<!doctype html>",
      `<html lang="en" class="theme-${options.theme}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(agentPet.name)} Codex pet</title>`,
      "<style>",
      "html{--bg:#111318;--card:#171a22;--stage:#0f1117;--line:#2b303b;--fg:#f7f8fb;--muted:#c1c6d1;--hint:#8f99a8;--accent:#90f1df;--accent-bg:rgba(61,125,117,.16);--button:#ffbd4a;--button-fg:#111318;color-scheme:dark}",
      "html.theme-light{--bg:#f4f6f8;--card:#fff;--stage:#eef2f6;--line:#d7dee8;--fg:#111827;--muted:#4b5563;--hint:#6b7280;--accent:#0f766e;--accent-bg:#dff7f1;--button:#111827;--button-fg:#fff;color-scheme:light}",
      "@media (prefers-color-scheme:light){html.theme-auto{--bg:#f4f6f8;--card:#fff;--stage:#eef2f6;--line:#d7dee8;--fg:#111827;--muted:#4b5563;--hint:#6b7280;--accent:#0f766e;--accent-bg:#dff7f1;--button:#111827;--button-fg:#fff;color-scheme:light}}",
      "html,body{margin:0;color:var(--fg);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      `body{${options.mode === "sprite" ? "background:transparent;display:grid;place-items:center" : "background:var(--bg);min-height:100vh;display:grid;place-items:center"}}`,
      ".embed-card{box-sizing:border-box;width:100%;max-width:360px;min-height:420px;padding:22px;display:flex;flex-direction:column;gap:16px;justify-content:space-between;background:var(--card);border:1px solid var(--line)}",
      ".embed-card--compact{max-width:320px;min-height:180px;padding:14px;gap:10px}",
      ".embed-card__stage{height:208px;display:grid;place-items:center;overflow:hidden;background:var(--stage);border:1px solid var(--line)}",
      ".embed-card--compact .embed-card__stage{height:108px}",
      `.embed-card__sprite{width:${sprite.width};height:${sprite.height};background-repeat:no-repeat;background-size:${sprite.backgroundSize};background-position:0 var(--pet-row-y);image-rendering:pixelated;animation:pet-state var(--pet-duration) steps(var(--pet-frames)) infinite}`,
      ".embed-card--compact .embed-card__sprite{transform:scale(.52)}",
      ".embed-sprite{display:grid;place-items:center;width:max-content;height:max-content;background:transparent}",
      ".embed-card__meta{display:flex;flex-direction:column;gap:8px}",
      ".embed-card--compact .embed-card__meta{gap:4px}",
      ".embed-card__kind{width:max-content;padding:3px 8px;border:1px solid var(--accent);background:var(--accent-bg);color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.04em}",
      ".embed-card--compact .embed-card__kind{font-size:10px;padding:2px 6px}",
      "h1{margin:0;font-size:22px;line-height:1.15;letter-spacing:0}",
      ".embed-card--compact h1{font-size:16px}",
      "p{margin:0;color:var(--muted);font-size:14px;line-height:1.45}",
      ".embed-card--compact p{font-size:12px;line-height:1.35}",
      ".embed-card__author,.embed-card__tags,.embed-card__compat{color:var(--hint)}",
      ".embed-card__description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".embed-card--compact .embed-card__description{display:none}",
      ".embed-card__actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      "a{color:var(--accent);text-decoration:none;font-size:14px}",
      ".embed-card__install{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 12px;background:var(--button);color:var(--button-fg);font-weight:700}",
      ".embed-card--compact .embed-card__actions a{font-size:12px}",
      "@keyframes pet-state{to{background-position:var(--pet-end-x) var(--pet-row-y)}}",
      "@media (prefers-reduced-motion:reduce){.embed-card__sprite{animation:none}}",
      "</style>",
      "</head>",
      "<body>",
      options.mode === "sprite"
        ? `<div class="embed-sprite" aria-label="${escapeHtmlAttribute(agentPet.name)}"><div class="embed-card__sprite" style="${escapeHtmlAttribute(spriteStyle)}"></div></div>`
        : [
            `<article class="${options.compact ? "embed-card embed-card--compact" : "embed-card"}">`,
            '<div class="embed-card__stage" aria-hidden="true">',
            `<div class="embed-card__sprite" style="${escapeHtmlAttribute(spriteStyle)}"></div>`,
            "</div>",
            '<div class="embed-card__meta">',
            `<span class="embed-card__kind">${escapeHtml(agentPet.kind)}</span>`,
            `<h1>${escapeHtml(agentPet.name)}</h1>`,
            options.showAuthor
              ? `<p class="embed-card__author">by ${escapeHtml(agentPet.author.name)}</p>`
              : "",
            `<p class="embed-card__description">${escapeHtml(agentPet.description)}</p>`,
            tags.length > 0
              ? `<p class="embed-card__tags">${tags.map((tag) => escapeHtml(tag)).join(" · ")}</p>`
              : "",
            '<p class="embed-card__compat">Codex-compatible</p>',
            "</div>",
            '<div class="embed-card__actions">',
            options.showInstall
              ? `<a class="embed-card__install" href="${escapeHtmlAttribute(agentPet.packageUrl)}" target="_blank" rel="noreferrer">Install</a>`
              : "",
            `<a href="${escapeHtmlAttribute(agentPet.pageUrl)}" target="_blank" rel="noreferrer">View in registry</a>`,
            "</div>",
            "</article>",
          ].join(""),
      "</body>",
      "</html>",
    ].join(""),
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

function readEmbedOptions(req: Request): EmbedOptions {
  const url = new URL(req.url);
  const stateKey = url.searchParams.get("state");
  const state =
    typeof stateKey === "string" && EMBED_STATE_KEYS.has(stateKey as EmbedStateKey)
      ? PET_STATES.find((item) => item.key === stateKey)
      : PET_STATES[0];

  return {
    mode: readMode(url.searchParams.get("mode")),
    theme: readTheme(url.searchParams.get("theme")),
    state: state ?? PET_STATES[0],
    scale: readSpriteScale(url.searchParams.get("scale")),
    compact: readBoolean(url.searchParams.get("compact"), false),
    showInstall: readBoolean(url.searchParams.get("showInstall"), true),
    showAuthor: readBoolean(url.searchParams.get("showAuthor"), true),
    showTags: readBoolean(url.searchParams.get("showTags"), true),
  };
}

function readMode(value: string | null): EmbedMode {
  return value === "sprite" ? "sprite" : "card";
}

function readTheme(value: string | null): EmbedTheme {
  return value === "light" || value === "dark" || value === "auto"
    ? value
    : "auto";
}

function readBoolean(value: string | null, defaultValue: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

function escapeHtml(value: string): string {
  return escapeHtmlAttribute(value);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
