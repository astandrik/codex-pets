import { describe, expect, it } from "vitest";

import {
  ASK_AI_PROVIDERS,
  buildAskAIProviderLinks,
} from "@/components/AskAI/ask-ai-links";

describe("Ask AI provider links", () => {
  it("builds the required provider links with an encoded prompt", () => {
    const links = buildAskAIProviderLinks("hello world & /?");

    expect(ASK_AI_PROVIDERS.map((provider) => provider.id)).toEqual([
      "chatgpt",
      "perplexity",
      "claude",
      "google-ai-mode",
      "grok",
    ]);
    expect(links).toEqual([
      {
        id: "chatgpt",
        label: "ChatGPT",
        href: "https://chatgpt.com/?q=hello%20world%20%26%20%2F%3F",
      },
      {
        id: "perplexity",
        label: "Perplexity",
        href: "https://www.perplexity.ai/search/new?q=hello%20world%20%26%20%2F%3F",
      },
      {
        id: "claude",
        label: "Claude",
        href: "https://claude.ai/new?q=hello%20world%20%26%20%2F%3F",
      },
      {
        id: "google-ai-mode",
        label: "Google AI Mode",
        href: "https://www.google.com/search?udm=50&aep=11&q=hello%20world%20%26%20%2F%3F",
      },
      {
        id: "grok",
        label: "Grok",
        href: "https://grok.com/?q=hello%20world%20%26%20%2F%3F",
      },
    ]);
  });
});
