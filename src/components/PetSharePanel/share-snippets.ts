import {
  AGENT_EMBED_HEIGHT,
  AGENT_EMBED_WIDTH,
  buildAgentCardCode,
  buildAgentEmbedCode,
} from "@/lib/pets/agent-snippets";
import { PET_SHEET } from "@/lib/pets/types";

export type PetShareSnippet = {
  id: "badge" | "card" | "embed" | "install";
  label: string;
  value: string;
};

export type PetShareMode = "sprite" | "card";

export type PetShareSource = {
  badgeMarkdown: string;
  cardGifUrl: string;
  embedUrl: string;
  installPrompt: string;
  name: string;
  pageUrl: string;
};

export function buildPetShareSnippets(
  source: PetShareSource,
  options: {
    mode: PetShareMode;
    scale: number;
    state: string;
  },
): PetShareSnippet[] {
  const cardUrl = buildShareUrl(source.cardGifUrl, options);
  const embedUrl = buildShareUrl(source.embedUrl, options);
  const spriteSize = {
    width: PET_SHEET.cellWidth * options.scale,
    height: PET_SHEET.cellHeight * options.scale,
  };
  const embedSize =
    options.mode === "sprite"
      ? spriteSize
      : { width: AGENT_EMBED_WIDTH, height: AGENT_EMBED_HEIGHT };

  return [
    {
      id: "badge",
      label: "README badge",
      value: source.badgeMarkdown,
    },
    {
      id: "card",
      label: options.mode === "sprite" ? "Animated sprite" : "Animated card",
      value: buildAgentCardCode({
        name: source.name,
        pageUrl: source.pageUrl,
        gifUrl: cardUrl,
        width: options.mode === "sprite" ? spriteSize.width : undefined,
        height: options.mode === "sprite" ? spriteSize.height : undefined,
      }).markdown,
    },
    {
      id: "embed",
      label: options.mode === "sprite" ? "Sprite embed" : "Card embed",
      value: buildAgentEmbedCode({
        name: source.name,
        embedUrl,
        width: embedSize.width,
        height: embedSize.height,
      }).iframe,
    },
    {
      id: "install",
      label: "Install prompt",
      value: source.installPrompt,
    },
  ];
}

function buildShareUrl(
  input: string,
  options: {
    mode: PetShareMode;
    scale: number;
    state: string;
  },
): string {
  const url = new URL(input);

  url.searchParams.set("mode", options.mode);
  url.searchParams.set("state", options.state);

  if (options.mode === "sprite") {
    url.searchParams.set("scale", String(options.scale));
  } else {
    url.searchParams.delete("scale");
  }

  return url.toString();
}
