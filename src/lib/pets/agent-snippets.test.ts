import { describe, expect, it } from "vitest";

import {
  AGENT_EMBED_HEIGHT,
  AGENT_EMBED_WIDTH,
  buildAgentBadgeCode,
  buildAgentEmbedCode,
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

  it("builds iframe embed code", () => {
    expect(
      buildAgentEmbedCode({
        name: 'Orbit "Otter"',
        embedUrl: "https://pets.example/embed/orbit-otter",
      }),
    ).toEqual({
      iframe:
        '<iframe title="Codex pet: Orbit &quot;Otter&quot;" src="https://pets.example/embed/orbit-otter" width="360" height="420" loading="lazy"></iframe>',
      url: "https://pets.example/embed/orbit-otter",
      width: AGENT_EMBED_WIDTH,
      height: AGENT_EMBED_HEIGHT,
    });
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
