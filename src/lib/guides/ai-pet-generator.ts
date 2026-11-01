import { toPublicUrl } from "@/lib/base-path";
import { buildGuideArticleJsonLd } from "@/lib/guides/shared";
import {IP_DAILY_LIMIT, GLOBAL_DAILY_LIMIT} from "@/lib/pets/generation/quota-limits";

export const AI_PET_GENERATOR_PATH = "/guides/ai-pet-generator";
export const AI_PET_GENERATOR_TITLE = "AI pet generator for Codex";
export const AI_PET_GENERATOR_DESCRIPTION =
  "Create an animated Codex pet from a text description. Preview nine animations and 16 look directions, download a v2 ZIP, and submit it for moderation.";
export const AI_PET_GENERATOR_DATE = "2026-10-11";
export const AI_PET_GENERATOR_WARNING =
  "Generation is experimental. Animation continuity and look directions can be imperfect. Review the preview before using or submitting a pet; a successful generation does not guarantee visual quality.";
export const AI_PET_GENERATOR_SECTIONS = [
  {
    title: "From a description to an animated pet",
    paragraphs: [
      "Describe your character, its colors and style. You can add a name, and no account is required. For example: a mint-green cat with oversized round glasses, or a friendly yellow trolleybus with a tiny face.",
      "After the images are generated, one additional AI request drafts a name, description and tags. Review and edit them on the private result page, then save before downloading or sending the pet for moderation. Saving edits does not regenerate images or make another paid request.",
      "Open the private progress page after submitting. Once the pet is ready, inspect every animation and look direction in the player, then download the ZIP, pet.json or spritesheet. The v2 pack has a transparent 1536×2288 atlas, nine animation states and 16 look directions.",
    ],
  },
  {
    title: "Daily limits and availability",
    paragraphs: [
      `Generation is funded by this service. The default limit is ${IP_DAILY_LIMIT} accepted tasks per IP and ${GLOBAL_DAILY_LIMIT} for the whole service per Moscow day; the operator can configure both. Administrators can grant extra IP attempts, but those do not bypass the global limit. There is no monetary threshold by default; an operator can enable one. Allowances reset at midnight Moscow time.`,
      "One pet is generated at a time, with up to 30 tasks waiting by default (the service administrator can configure capacity). A task stays queued until it starts or its original 24-hour lifetime expires; waiting alone does not cancel it earlier. Accepted tasks count toward the daily allowance even if generation later fails. An AI safety refusal or network failure can stop a task; a failed image stage may receive one delayed retry. Successful image stages are kept, and metadata generation is not retried.",
      "People behind the same network or MCP gateway share the IP limit. If a limit is reached, the form explains whether it is your IP allowance, the global allowance or the spending budget.",
    ],
  },
  {
    title: "Private first, published only after moderation",
    paragraphs: [
      "Your progress and result use an unlisted link. Anyone with that link can open it, so share it carefully. The prompt and generated files expire 24 hours after the task is accepted, including time spent in the queue. Download the finished pack before then.",
      "Generation does not add a pet to the public gallery. To publish, choose an available gallery address on the result page and send the pet for moderation. It appears in the gallery only after approval.",
    ],
  },
  {
    title: "Generate from an MCP client",
    paragraphs: [
      "The remote Pets MCP endpoint also offers generate_pet and get_pet_generation. Generation is a server-paid operation with side effects and shares the website queue and limits. Use a unique requestId for each new task and keep it unchanged when retrying the same request after a lost response.",
      "get_pet_generation returns progress and, when ready, private preview and download links. The npm CLI and browser WebMCP do not offer generation in this release.",
    ],
  },
] as const;

export function getAiPetGeneratorJsonLd() {
  return buildGuideArticleJsonLd({
    path: AI_PET_GENERATOR_PATH,
    title: AI_PET_GENERATOR_TITLE,
    description: AI_PET_GENERATOR_DESCRIPTION,
    datePublished: AI_PET_GENERATOR_DATE,
    dateModified: "2026-10-12",
  });
}

export function buildAiPetGeneratorMarkdown() {
  return [
    `# ${AI_PET_GENERATOR_TITLE}`,
    "",
    AI_PET_GENERATOR_DESCRIPTION,
    "",
    `**Experimental:** ${AI_PET_GENERATOR_WARNING}`,
    "",
    `[Generate a pet](${toPublicUrl("/generate")})`,
    "",
    ...AI_PET_GENERATOR_SECTIONS.flatMap(section => [
      `## ${section.title}`, "", ...section.paragraphs.flatMap(text => [text, ""]),
    ]),
    `[See a generated pet: Trolleybus](${toPublicUrl("/pets/trolleybus")})`,
    `[MCP documentation](${toPublicUrl("/mcp.md")})`,
    `[Request help from the admins](${toPublicUrl("/request")})`,
    `[Read this guide on the website](${toPublicUrl(AI_PET_GENERATOR_PATH)})`,
    "",
  ].join("\n");
}
