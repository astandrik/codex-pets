import { describe, expect, it } from "vitest";

import {
  buildPetShareSnippets,
  type PetShareSource,
} from "@/components/PetSharePanel/share-snippets";

const source: PetShareSource = {
  badgeMarkdown:
    "[![Codex pet: Orbit Otter](https://pets.example/badge/orbit-otter.svg)](https://pets.example/pets/orbit-otter)",
  cardGifUrl:
    "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle",
  embedUrl:
    "https://pets.example/embed/orbit-otter?mode=sprite&scale=2&state=idle",
  installPrompt:
    "Install the Orbit Otter Codex pet from https://pets.example/pets/orbit-otter",
  name: "Orbit Otter",
  pageUrl: "https://pets.example/pets/orbit-otter",
};

describe("PetSharePanel snippet builder", () => {
  it("builds sprite-mode snippets with chosen state and scale", () => {
    const snippets = buildPetShareSnippets(source, {
      mode: "sprite",
      scale: 3,
      state: "review",
    });

    expect(snippets[0]).toMatchObject({
      id: "badge",
      label: "README badge",
    });
    expect(snippets[1]).toMatchObject({
      id: "card",
      label: "Animated sprite",
    });
    expect(snippets[1].value).toContain(
      "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=3&state=review",
    );
    expect(snippets[2]).toMatchObject({
      id: "embed",
      label: "Sprite embed",
    });
    expect(snippets[2].value).toContain(
      'src="https://pets.example/embed/orbit-otter?mode=sprite&amp;scale=3&amp;state=review"',
    );
    expect(snippets[2].value).toContain('width="576"');
    expect(snippets[2].value).toContain('height="624"');
  });

  it("builds card-mode snippets without scale param", () => {
    const snippets = buildPetShareSnippets(source, {
      mode: "card",
      scale: 4,
      state: "running",
    });

    expect(snippets[1]).toMatchObject({
      id: "card",
      label: "Animated card",
    });
    expect(snippets[1].value).toContain(
      "https://pets.example/card/orbit-otter.gif?mode=card&state=running",
    );
    expect(snippets[1].value).not.toContain("scale=4");
    expect(snippets[2]).toMatchObject({
      id: "embed",
      label: "Card embed",
    });
    expect(snippets[2].value).toContain(
      'src="https://pets.example/embed/orbit-otter?mode=card&amp;state=running"',
    );
    expect(snippets[2].value).toContain('width="360"');
    expect(snippets[2].value).toContain('height="420"');
  });
});
