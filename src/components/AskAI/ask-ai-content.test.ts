import { describe, expect, it } from "vitest";

import {
  ASK_AI_AGENTS,
  ASK_AI_HOME,
  ASK_AI_REQUEST,
  buildPetDetailAskAIPrompt,
} from "@/components/AskAI/ask-ai-content";

describe("Ask AI content", () => {
  it("keeps the static prompts exact", () => {
    expect(ASK_AI_HOME.prompt).toBe(
      "Act as a Codex user looking for animated desktop companions. Using current information from https://pets.ydb-qdrant.tech/, explain what Codex Pets is, how to browse and install pet packs, how MCP/API access works, how to request or submit a pet, and recommend a few pets for different styles such as cute, pixel, anime, minimal, fantasy, and unusual.",
    );
    expect(ASK_AI_AGENTS.prompt).toBe(
      "Act as a coding agent user setting up Codex Pets. Using current information from https://pets.ydb-qdrant.tech/agents and https://pets.ydb-qdrant.tech/llms.txt, explain how the MCP endpoint, manifest JSON, manifest TOON, pet search endpoints, and install commands work. Give me the shortest reliable setup path.",
    );
    expect(ASK_AI_REQUEST.prompt).toBe(
      "Help me draft a clear Codex pet request for https://pets.ydb-qdrant.tech/request. Ask for the visual style, character or object concept, mood, animation expectations, reference-image notes, and display name. Then produce a concise request I can paste into the form.",
    );
  });

  it("inserts the canonical pet page URL into the detail prompt", () => {
    expect(
      buildPetDetailAskAIPrompt("https://pets.example/pets/orbit-otter"),
    ).toBe(
      "Using this Codex Pets page, explain what this pet pack contains, how to install it in Codex, what style and tags it has, who it is likely to fit, and whether it is a good lightweight animated coding companion. Use current information from this page URL: https://pets.example/pets/orbit-otter.",
    );
  });
});
