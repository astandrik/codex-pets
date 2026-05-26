export const ASK_AI_PRODUCT_NAME = "codex-pets";

export const ASK_AI_HOME = {
  label: "Ask AI to pick a Codex pet",
  helperText:
    "Open an AI assistant with the gallery context and ask for recommendations.",
  page: "home",
  promptVariant: "homepage",
  prompt:
    "Act as a Codex user looking for animated desktop companions. Using current information from https://pets.ydb-qdrant.tech/, explain what Codex Pets is, how to browse and install pet packs, how MCP/API access works, how to request or submit a pet, and recommend a few pets for different styles such as cute, pixel, anime, minimal, fantasy, and unusual.",
} as const;

export const ASK_AI_PET_DETAIL = {
  label: "Ask AI about this pet",
  helperText:
    "Ask an AI assistant to explain the pack, install command, style, and fit.",
  page: "pet_detail",
  promptVariant: "pet_detail",
} as const;

export const ASK_AI_AGENTS = {
  label: "Ask AI how to connect Codex Pets",
  helperText: "Open an AI assistant with MCP, manifest, and API setup context.",
  page: "agents",
  promptVariant: "agents",
  prompt:
    "Act as a coding agent user setting up Codex Pets. Using current information from https://pets.ydb-qdrant.tech/agents and https://pets.ydb-qdrant.tech/llms.txt, explain how the MCP endpoint, manifest JSON, manifest TOON, pet search endpoints, and install commands work. Give me the shortest reliable setup path.",
} as const;

export const ASK_AI_REQUEST = {
  label: "Ask AI to draft a pet request",
  helperText: "Get a clear request draft before submitting the form.",
  page: "request",
  promptVariant: "request",
  prompt:
    "Help me draft a clear Codex pet request for https://pets.ydb-qdrant.tech/request. Ask for the visual style, character or object concept, mood, animation expectations, reference-image notes, and display name. Then produce a concise request I can paste into the form.",
} as const;

export function buildPetDetailAskAIPrompt(pageUrl: string): string {
  return `Using this Codex Pets page, explain what this pet pack contains, how to install it in Codex, what style and tags it has, who it is likely to fit, and whether it is a good lightweight animated coding companion. Use current information from this page URL: ${pageUrl}.`;
}
