"use client";

import { useState } from "react";
import { Button, Card, Flex, Text } from "@/components/GravityUI/GravityUI";
import { Check, Copy } from "@gravity-ui/icons";

import { trackGoal } from "@/lib/metrics/yandex";
import { PET_STATES } from "@/lib/pets/types";
import {
  buildPetShareSnippets,
  type PetShareMode,
  type PetShareSnippet,
  type PetShareSource,
} from "@/components/PetSharePanel/share-snippets";
import "./PetSharePanel.scss";

export type PetShareStateKey = (typeof PET_STATES)[number]["key"];

type PetSharePanelProps = {
  slug: string;
  source: PetShareSource;
};

const SPRITE_SCALES = [1, 2, 3, 4] as const;

export function PetSharePanel({ slug, source }: PetSharePanelProps) {
  const [status, setStatus] = useState<
    Record<string, "idle" | "copied" | "error">
  >({});
  const [mode, setMode] = useState<PetShareMode>("sprite");
  const [state, setState] = useState<PetShareStateKey>("idle");
  const [scale, setScale] = useState<number>(2);
  const snippets = buildPetShareSnippets(source, { mode, scale, state });

  async function handleCopy(snippet: PetShareSnippet) {
    try {
      await copyText(snippet.value);
      setStatus((current) => ({ ...current, [snippet.id]: "copied" }));
      trackGoal("pet_share_snippet_copy", {
        mode,
        scale,
        slug,
        state,
        snippet: snippet.id,
      });
      window.setTimeout(() => {
        setStatus((current) => ({ ...current, [snippet.id]: "idle" }));
      }, 1800);
    } catch {
      setStatus((current) => ({ ...current, [snippet.id]: "error" }));
      window.setTimeout(() => {
        setStatus((current) => ({ ...current, [snippet.id]: "idle" }));
      }, 2200);
    }
  }

  return (
    <Card view="raised" className="pet-share-panel">
      <Flex direction="column" gap={4}>
        <Flex direction="column" gap={1}>
          <Text variant="subheader-2" as="h2">
            Share this pet
          </Text>
        </Flex>
        <div className="pet-share-panel__controls">
          <div className="pet-share-panel__control">
            <Text
              variant="caption-2"
              color="secondary"
              className="pet-share-panel__control-label"
            >
              Format
            </Text>
            <div className="pet-share-panel__segmented" role="tablist">
              {(["sprite", "card"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    mode === value
                      ? "pet-share-panel__segment pet-share-panel__segment_active"
                      : "pet-share-panel__segment"
                  }
                  onClick={() => setMode(value)}
                >
                  {value === "sprite" ? "Sprite" : "Card"}
                </button>
              ))}
            </div>
          </div>
          <div className="pet-share-panel__control">
            <Text
              variant="caption-2"
              color="secondary"
              className="pet-share-panel__control-label"
            >
              Animation
            </Text>
            <label className="pet-share-panel__select-wrap">
              <select
                className="pet-share-panel__select"
                value={state}
                onChange={(event) => setState(event.target.value as PetShareStateKey)}
              >
                {PET_STATES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === "sprite" ? (
            <div className="pet-share-panel__control">
              <Text
                variant="caption-2"
                color="secondary"
                className="pet-share-panel__control-label"
              >
                Scale
              </Text>
              <div className="pet-share-panel__segmented" role="tablist">
                {SPRITE_SCALES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      scale === value
                        ? "pet-share-panel__segment pet-share-panel__segment_active"
                        : "pet-share-panel__segment"
                    }
                    onClick={() => setScale(value)}
                  >
                    {value}x
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="pet-share-panel__snippets">
          {snippets.map((snippet) => {
            const copyStatus = status[snippet.id] ?? "idle";
            const copied = copyStatus === "copied";

            return (
              <div className="pet-share-panel__snippet" key={snippet.id}>
                <Text
                  variant="caption-2"
                  color="secondary"
                  className="pet-share-panel__label"
                >
                  {snippet.label}
                </Text>
                <div className="pet-share-panel__row">
                  <code className="pet-share-panel__code" title={snippet.value}>
                    {snippet.value}
                  </code>
                  <Button
                    view="flat"
                    size="s"
                    onClick={() => handleCopy(snippet)}
                    aria-label={`Copy ${snippet.label}`}
                    title={`Copy ${snippet.label}`}
                    className="pet-share-panel__button"
                  >
                    {copied ? (
                      <Check width={16} height={16} />
                    ) : (
                      <Copy width={16} height={16} />
                    )}
                    <span>{buttonText(copyStatus)}</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Flex>
    </Card>
  );
}

function buttonText(status: "idle" | "copied" | "error"): string {
  if (status === "copied") return "Copied";
  if (status === "error") return "Failed";
  return "Copy";
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy_failed");
    }
  } finally {
    textarea.remove();
  }
}
