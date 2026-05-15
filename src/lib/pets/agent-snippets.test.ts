import { describe, expect, it } from "vitest";

import {
  AGENT_SPRITE_HEIGHT,
  AGENT_SPRITE_WIDTH,
  buildAgentBadgeCode,
  buildAgentCardCode,
  buildAgentEmbedCode,
  buildAgentInstallPrompt,
  buildAgentInstallInstructions,
  buildBadgeSvg,
} from "@/lib/pets/agent-snippets";

describe("agent snippets", () => {
  it("builds install instructions without side effects", () => {
    expect(
      buildAgentInstallInstructions({
        slug: "orbit-otter",
        mcpUrl: "https://pets.example/mcp",
        manifestUrl: "https://pets.example/api/assets/a/pet.json",
        packageUrl: "https://pets.example/api/assets/a/pet.zip",
        spritesheetUrl: "https://pets.example/api/assets/a/spritesheet.webp",
      }),
    ).toMatchObject({
      slug: "orbit-otter",
      command: "npx @astandrik/codex-pets install orbit-otter",
      codex: {
        command: "npx @astandrik/codex-pets install orbit-otter",
      },
      manual: {
        steps: expect.arrayContaining([
          "Download the package ZIP from https://pets.example/api/assets/a/pet.zip.",
        ]),
      },
    });
  });

  it("builds README badge snippets", () => {
    expect(
      buildAgentBadgeCode({
        name: "Orbit [Otter]",
        pageUrl: "https://pets.example/pets/orbit-otter",
        svgUrl: "https://pets.example/badge/orbit-otter.svg",
      }),
    ).toEqual({
      markdown:
        "[![Codex pet: Orbit \\[Otter\\]](https://pets.example/badge/orbit-otter.svg)](https://pets.example/pets/orbit-otter)",
      html: '<a href="https://pets.example/pets/orbit-otter"><img alt="Codex pet: Orbit [Otter]" src="https://pets.example/badge/orbit-otter.svg"></a>',
      svgUrl: "https://pets.example/badge/orbit-otter.svg",
    });
  });

  it("builds animated README card snippets", () => {
    expect(
      buildAgentCardCode({
        name: "Orbit [Otter]",
        pageUrl: "https://pets.example/pets/orbit-otter",
        gifUrl:
          "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle",
      }),
    ).toEqual({
      markdown:
        "[![Orbit \\[Otter\\] Codex pet](https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle)](https://pets.example/pets/orbit-otter)",
      html: '<a href="https://pets.example/pets/orbit-otter"><img alt="Orbit [Otter] Codex pet" src="https://pets.example/card/orbit-otter.gif?mode=sprite&amp;scale=2&amp;state=idle" width="384" height="416"></a>',
      gifUrl:
        "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle",
      width: AGENT_SPRITE_WIDTH,
      height: AGENT_SPRITE_HEIGHT,
    });
  });

  it("builds iframe embed code", () => {
    expect(
      buildAgentEmbedCode({
        name: 'Orbit "Otter"',
        embedUrl:
          "https://pets.example/embed/orbit-otter?mode=sprite&scale=2&state=idle",
        width: AGENT_SPRITE_WIDTH,
        height: AGENT_SPRITE_HEIGHT,
      }),
    ).toEqual({
      iframe:
        '<iframe title="Codex pet: Orbit &quot;Otter&quot;" src="https://pets.example/embed/orbit-otter?mode=sprite&amp;scale=2&amp;state=idle" width="384" height="416" loading="lazy"></iframe>',
      url:
        "https://pets.example/embed/orbit-otter?mode=sprite&scale=2&state=idle",
      width: AGENT_SPRITE_WIDTH,
      height: AGENT_SPRITE_HEIGHT,
    });
  });

  it("builds agent install prompt text", () => {
    expect(
      buildAgentInstallPrompt({
        name: "Orbit Otter",
        pageUrl: "https://pets.example/pets/orbit-otter",
      }),
    ).toBe(
      "Install the Orbit Otter Codex pet from https://pets.example/pets/orbit-otter",
    );
  });

  it("escapes badge SVG text", () => {
    const svg = buildBadgeSvg({
      name: "Orbit <Otter>",
      kind: "creature",
    });

    expect(svg).toContain("Orbit &lt;Otter&gt;");
    expect(svg).not.toContain("Orbit <Otter>");
  });
});
