"use client";

import { Card, Flex, Text } from "@/components/GravityUI/GravityUI";
import { ArrowUpRight, Sparkles } from "@gravity-ui/icons";

import { trackGoal } from "@/lib/metrics/yandex";
import {
  buildAskAIProviderLinks,
  type AskAIProviderId,
} from "@/components/AskAI/ask-ai-links";
import "./AskAIPanel.scss";

type AskAIPanelProps = {
  productName: string;
  label: string;
  helperText: string;
  prompt: string;
  page: string;
  promptVariant: string;
  petSlug?: string;
};

export function AskAIPanel({
  productName,
  label,
  helperText,
  prompt,
  page,
  promptVariant,
  petSlug,
}: AskAIPanelProps) {
  const links = buildAskAIProviderLinks(prompt);

  function trackClick(provider: AskAIProviderId) {
    trackGoal("ask_ai_click", {
      product: productName,
      page,
      provider,
      prompt_variant: promptVariant,
      ...(petSlug ? { pet_slug: petSlug } : {}),
    });
  }

  return (
    <Card view="raised" className="ask-ai-panel">
      <Flex direction="column" gap={3}>
        <Flex gap={2} alignItems="flex-start" className="ask-ai-panel__header">
          <span className="ask-ai-panel__icon" aria-hidden="true">
            <Sparkles width={18} height={18} />
          </span>
          <span className="ask-ai-panel__copy">
            <Text variant="subheader-2" as="h2">
              {label}
            </Text>
            <Text variant="body-1" color="secondary">
              {helperText}
            </Text>
          </span>
        </Flex>
        <div className="ask-ai-panel__links" aria-label={label}>
          {links.map((link) => (
            <a
              key={link.id}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="ask-ai-panel__link"
              onClick={() => trackClick(link.id)}
            >
              <span>{link.label}</span>
              <ArrowUpRight width={16} height={16} aria-hidden="true" />
            </a>
          ))}
        </div>
      </Flex>
    </Card>
  );
}
