import {HOME_ASK_AI} from "@/lib/product-copy";

export const ASK_AI_PRODUCT_NAME = "codex-pets";

export const ASK_AI_HOME = {...HOME_ASK_AI,helperText:HOME_ASK_AI.helper,page:"home",promptVariant:"homepage"} as const;

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
