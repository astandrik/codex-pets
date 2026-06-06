import {
  escapeMarkdownInlineText,
  formatMarkdownInlineList,
} from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";
import { createAgentPet } from "@/lib/pets/agent-dto";
import type { PublicPet } from "@/lib/pets/types";

export function buildPetMarkdown(pet: PublicPet): string {
  const agentPet = createAgentPet(pet);
  const displayName = escapeMarkdownInlineText(pet.displayName);
  const description = escapeMarkdownInlineText(pet.description);
  const tags = formatMarkdownInlineList(pet.tags);
  const authorName = escapeMarkdownInlineText(agentPet.author.name);
  const author = agentPet.author.profileUrl
    ? `[${authorName}](${agentPet.author.profileUrl})`
    : authorName;

  return [
    `# ${displayName}`,
    "",
    `Pet description: ${description}`,
    "",
    "## Public page",
    "",
    `- Page: ${agentPet.pageUrl}`,
    `- Kind: ${pet.kind}`,
    `- Tags: ${tags}`,
    `- Author: ${author}`,
    "",
    "## Install",
    "",
    "```bash",
    agentPet.installCommand,
    "```",
    "",
    "## Package assets",
    "",
    `- pet.json: ${agentPet.petJsonUrl}`,
    `- spritesheet: ${agentPet.spritesheetUrl}`,
    `- ZIP package: ${agentPet.zipUrl}`,
    "",
    "## Share links",
    "",
    `- Share JSON: ${toPublicUrl(`/api/pets/${encodeURIComponent(pet.slug)}/share`)}`,
    `- Badge SVG: ${agentPet.badge.svgUrl}`,
    `- Card GIF: ${agentPet.card.gifUrl}`,
    `- Embed: ${agentPet.embed.url}`,
    "",
    "## Agent guidance",
    "",
    `Use this pet when a user asks for a ${pet.kind} Codex pet pack with tags such as ${tags}. Cite the public page URL and return the install command.`,
  ].join("\n");
}
