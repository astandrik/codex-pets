import { buildPetInstallCommand } from "@/lib/pets/install-command";

export const AGENT_EMBED_WIDTH = 360;
export const AGENT_EMBED_HEIGHT = 420;
export const AGENT_SPRITE_WIDTH = 384;
export const AGENT_SPRITE_HEIGHT = 416;

export type AgentInstallInstructions = {
  slug: string;
  command: string;
  codex: {
    command: string;
    mcpServer: {
      addCommand: string;
      configToml: string;
    };
  };
  cursor: {
    command: string;
    note: string;
  };
  claudeCode: {
    command: string;
    note: string;
  };
  manual: {
    steps: string[];
  };
};

export type AgentBadgeCode = {
  markdown: string;
  html: string;
  svgUrl: string;
};

export type AgentCardCode = {
  markdown: string;
  html: string;
  gifUrl: string;
  width: number;
  height: number;
};

export type AgentEmbedCode = {
  iframe: string;
  url: string;
  width: number;
  height: number;
};

export function buildAgentInstallInstructions(input: {
  slug: string;
  mcpUrl: string;
  manifestUrl: string;
  packageUrl: string;
  spritesheetUrl: string;
}): AgentInstallInstructions {
  const command = buildPetInstallCommand(input.slug);

  return {
    slug: input.slug,
    command,
    codex: {
      command,
      mcpServer: {
        addCommand: `codex mcp add codexPets --url ${input.mcpUrl}`,
        configToml: [
          "[mcp_servers.codexPets]",
          `url = "${input.mcpUrl}"`,
        ].join("\n"),
      },
    },
    cursor: {
      command,
      note: "Run the CLI from your local shell, then restart or refresh your coding agent if it caches pet assets.",
    },
    claudeCode: {
      command,
      note: "Run the CLI from your local shell. The package format is the same Codex pet.json plus spritesheet atlas.",
    },
    manual: {
      steps: [
        `Download the package ZIP from ${input.packageUrl}.`,
        `Use ${input.manifestUrl} for pet.json metadata.`,
        `Use ${input.spritesheetUrl} for the spritesheet atlas.`,
        `Install with ${command} when the npm CLI is available.`,
      ],
    },
  };
}

export function buildAgentBadgeCode(input: {
  name: string;
  pageUrl: string;
  svgUrl: string;
}): AgentBadgeCode {
  const alt = `Codex pet: ${input.name}`;

  return {
    markdown: `[![${escapeMarkdownAlt(alt)}](${input.svgUrl})](${input.pageUrl})`,
    html: `<a href="${escapeHtmlAttribute(input.pageUrl)}"><img alt="${escapeHtmlAttribute(alt)}" src="${escapeHtmlAttribute(input.svgUrl)}"></a>`,
    svgUrl: input.svgUrl,
  };
}

export function buildAgentCardCode(input: {
  name: string;
  pageUrl: string;
  gifUrl: string;
  width?: number;
  height?: number;
}): AgentCardCode {
  const alt = `${input.name} Codex pet`;
  const width = input.width ?? AGENT_SPRITE_WIDTH;
  const height = input.height ?? AGENT_SPRITE_HEIGHT;

  return {
    markdown: `[![${escapeMarkdownAlt(alt)}](${input.gifUrl})](${input.pageUrl})`,
    html: `<a href="${escapeHtmlAttribute(input.pageUrl)}"><img alt="${escapeHtmlAttribute(alt)}" src="${escapeHtmlAttribute(input.gifUrl)}" width="${width}" height="${height}"></a>`,
    gifUrl: input.gifUrl,
    width,
    height,
  };
}

export function buildAgentEmbedCode(input: {
  name: string;
  embedUrl: string;
  width?: number;
  height?: number;
}): AgentEmbedCode {
  const width = input.width ?? AGENT_EMBED_WIDTH;
  const height = input.height ?? AGENT_EMBED_HEIGHT;

  return {
    iframe: `<iframe title="${escapeHtmlAttribute(`Codex pet: ${input.name}`)}" src="${escapeHtmlAttribute(input.embedUrl)}" width="${width}" height="${height}" loading="lazy"></iframe>`,
    url: input.embedUrl,
    width,
    height,
  };
}

export function buildAgentInstallPrompt(input: {
  name: string;
  pageUrl: string;
}): string {
  return `Install the ${input.name} Codex pet from ${input.pageUrl}`;
}

export function buildBadgeSvg(input: {
  name: string;
  kind: string;
}): string {
  const label = "codex pet";
  const value = `${input.name} - ${input.kind}`;
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const width = labelWidth + valueWidth;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(`${label}: ${value}`)}">`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-opacity=".16"/></linearGradient>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="20" fill="#555"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#2f8f83"/>`,
    `<rect width="${width}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>`,
    `<text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

function textWidth(value: string): number {
  return Math.max(64, Math.min(280, value.length * 7 + 12));
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value: string): string {
  return escapeHtmlAttribute(value).replace(/'/g, "&apos;");
}
