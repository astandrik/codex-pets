import { NextResponse } from "next/server";

import { createAgentPet, readSafeAgentSlug } from "@/lib/pets/agent-dto";
import { getApprovedPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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
  const previewUrl =
    agentPet.idleStripUrl ?? agentPet.previewImageUrl ?? agentPet.spritesheetUrl;
  const animated = agentPet.idleStripUrl ? " embed-card__sprite--strip" : "";

  return new Response(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(agentPet.name)} Codex pet</title>`,
      "<style>",
      "html,body{margin:0;background:#111318;color:#f7f8fb;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      "body{min-height:100vh;display:grid;place-items:center}",
      ".embed-card{box-sizing:border-box;width:100%;max-width:360px;min-height:420px;padding:22px;display:flex;flex-direction:column;gap:16px;justify-content:space-between;background:#171a22;border:1px solid #2b303b}",
      ".embed-card__stage{height:208px;display:grid;place-items:center;overflow:hidden;background:#0f1117;border:1px solid #303642}",
      ".embed-card__sprite{max-width:192px;max-height:208px;object-fit:contain;image-rendering:auto}",
      ".embed-card__sprite--strip{max-width:none;width:1152px;height:208px;object-fit:cover;object-position:left top;animation:pet-idle .84s steps(6) infinite}",
      ".embed-card__meta{display:flex;flex-direction:column;gap:8px}",
      ".embed-card__kind{width:max-content;padding:3px 8px;border:1px solid #3d7d75;color:#90f1df;font-size:12px;text-transform:uppercase;letter-spacing:.04em}",
      "h1{margin:0;font-size:22px;line-height:1.15;letter-spacing:0}",
      "p{margin:0;color:#c1c6d1;font-size:14px;line-height:1.45}",
      "a{color:#9ad7ff;text-decoration:none;font-size:14px}",
      "@keyframes pet-idle{to{transform:translateX(-1152px)}}",
      "</style>",
      "</head>",
      "<body>",
      '<article class="embed-card">',
      '<div class="embed-card__stage" aria-hidden="true">',
      `<img class="embed-card__sprite${animated}" src="${escapeHtmlAttribute(previewUrl)}" alt="">`,
      "</div>",
      '<div class="embed-card__meta">',
      `<span class="embed-card__kind">${escapeHtml(agentPet.kind)}</span>`,
      `<h1>${escapeHtml(agentPet.name)}</h1>`,
      `<p>${escapeHtml(agentPet.description)}</p>`,
      "</div>",
      `<a href="${escapeHtmlAttribute(agentPet.pageUrl)}" target="_blank" rel="noreferrer">View in Codex Pets</a>`,
      "</article>",
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
