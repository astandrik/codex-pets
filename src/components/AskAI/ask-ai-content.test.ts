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
      "Using current information from https://pets.ydb-qdrant.tech/ and https://pets.ydb-qdrant.tech/guides/ai-pet-generator, help me create or choose an animated Codex pet. Explain how I can start from a description or image, review the character, animate it, and download the pack. Suggest three distinct character ideas with short descriptions I can use in the generator, and offer existing gallery pets if I prefer a ready-made option. Link to /generate for self-service creation and mention the current limits and 24-hour retention. Do not submit a generation or call a paid/mutating tool without my explicit request.",
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
