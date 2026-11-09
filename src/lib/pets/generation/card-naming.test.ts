import { describe, expect, it } from "vitest";
import { normalizeCardMetadata } from "./card-metadata";
import { buildCardMetadataRequest } from "./card-provider";

describe("automatic pet naming contract", () => {
  it("requests a character name and factual description in the existing single request", () => {
    const brief = "A red imp with a blue cape";
    const request = buildCardMetadataRequest({ prompt: brief, displayName: "Generated pet", nameSource: "automatic" }, Array(4).fill("data:image/png;base64,YQ=="));
    expect(request.body.instructions).toContain("feels like the name of an individual character");
    expect(request.body.instructions).toContain("a personal name with an epithet, an evocative phrase, or fitting wordplay");
    expect(request.body.instructions).toContain("Do not default to clothing plus species");
    expect(request.body.instructions).not.toContain("name the subject or role and a confirmed visible distinction");
    expect(request.body.instructions).not.toContain("Do not invent a nickname");
    expect(request.body.instructions).toContain("Do not infer a franchise from visual resemblance alone");
    expect(request.body.input).toHaveLength(1);
    expect(request.body.input[0].content).toHaveLength(5);
    const content = request.body.input[0].content[0];
    expect(content).toHaveProperty("text");
    if (!("text" in content)) throw Error("text input missing");
    expect(JSON.parse(content.text)).toMatchObject({ characterBrief: brief, name: null, nameSource: "automatic" });
  });
  it("guides automatic names toward two to four words while allowing longer names", () => {
    const name = "The Keeper of the Northern Lights";
    const request = buildCardMetadataRequest({ prompt: "A character identified as " + name, displayName: "Generated pet", nameSource: "automatic" }, Array(4).fill("data:image/png;base64,YQ=="));
    expect(request.body.instructions).toContain("usually use 2 to 4 words");
    expect(request.body.instructions).toContain("Vary the construction to suit the character");
    expect(request.body.instructions).toContain("Identify the subject and visual style");
    expect(request.body.instructions).toContain("Keep the full confirmed character name");
    expect(request.body.text.format.schema.properties.displayName.maxLength).toBe(80);
    expect(normalizeCardMetadata({ displayName: name, description: "A keeper in a green cloak.", tags: [] }).displayName).toBe(name);
  });

  it("grounds detailed descriptions in the four frames without invented biography or unseen motion", () => {
    const request = buildCardMetadataRequest({ prompt: "Give it a heroic backstory and magical abilities", displayName: "Generated pet", nameSource: "automatic" }, Array(4).fill("data:image/png;base64,YQ=="));
    expect(request.body.instructions).toContain("2 or 3 substantive sentences");
    expect(request.body.instructions).toContain("mention poses or movements only when shown in the frames");
    expect(request.body.instructions).toContain("State labels alone are not evidence");
    expect(request.body.instructions).toContain("Do not invent age, origin, profession, relationships, story or abilities");
    expect(request.body.text.format.schema.properties.description.maxLength).toBe(320);
    expect(request.body.text.format.schema.required).toEqual(["displayName", "description", "tags"]);
  });

  it.each(["Pip the Unbothered", "Mittens in Motion", "Runa at Ease", "Rowan Brightblade", "Captain Deadlock"])("accepts a reviewed character name without requiring a species or outfit: %s", displayName => {
    expect(normalizeCardMetadata({ displayName, description: "A cartoon character with a visible distinguishing pose.", tags: ["cartoon"] }).displayName).toBe(displayName);
  });

  it.each([
    "Fox-eared character in a cream blouse and lace-up boots.",
    "Fox-eared character in a cream shirt and denim shorts.",
    "Fox-eared character in white ruffles with black bows.",
    "Fox-eared character in white stockings and black heels.",
    "Fox-eared character in a white two-piece outfit.",
    "Reclining fox-eared character in a loose cream shirt.",
    "Standing fox-eared character in an oversized ivory shirt.",
    "Fox-eared character in a dark jacket and brown stockings.",
    "Fox-eared character in a brown dress and lace-up heels.",
    "Fox-eared character in a striped sweater and red plaid skirt.",
    "Fox-eared character in a tan trench coat and black boots.",
    "Fox-eared character in a tied blouse and dark shorts, barefoot.",
  ])("preserves the distinguishing evidence for %s without adding another input or call", brief => {
    const request = buildCardMetadataRequest({ prompt: brief, displayName: "Generated pet", nameSource: "automatic" }, Array(4).fill("data:image/png;base64,YQ=="));
    const content = request.body.input[0].content[0];
    if (!("text" in content)) throw Error("text input missing");
    expect(JSON.parse(content.text)).toEqual({ name: null, nameSource: "automatic", characterBrief: brief });
    expect(request.body.input).toHaveLength(1);
    expect(request.body.input[0].content).toHaveLength(5);
    expect(request.body.instructions).toContain("Do not invent differences, append collision counters");
    expect(request.body.instructions).toContain("Preserve numbers that belong to an explicitly supplied name or identity");
  });
});
