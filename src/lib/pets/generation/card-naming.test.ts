import { describe, expect, it } from "vitest";
import { normalizeCardMetadata } from "./card-metadata";
import { buildCardMetadataRequest, parseCardMetadataResponse } from "./card-provider";

describe("automatic pet naming contract", () => {
  it("requests a character name and factual description in the existing single request", () => {
    const brief = "A red imp with a blue cape";
    const request = buildCardMetadataRequest({ prompt: brief, displayName: "Generated pet", nameSource: "automatic" }, Array(4).fill("data:image/png;base64,YQ=="));
    expect(request.body.instructions).toContain("distinctive visual motif");
    expect(request.body.instructions).toContain("standard animation frames");
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
    expect(request.body.text.format.schema.required).toContain("alternativeName");
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
    expect(request.body.text.format.schema.required).toEqual(["displayName", "description", "tags", "alternativeName"]);
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

describe("choosing an automatic name from one provider response", () => {
  const description = "A girl with a golden beret and a small shoulder bag.";
  const tags = ["beret", "gold", "bag"];
  const images = Array(4).fill("data:image/png;base64,YQ==");
  const request = buildCardMetadataRequest({ prompt: "", displayName: "Generated pet", nameSource: "automatic" }, images);

  it.each([
    ["Penny Quickstep", "Penny Raglan", "Penny Raglan"],
    ["Violet IN STRIDE!", "Cross My Boots", "Cross My Boots"],
    ["Wink On-the-Go", "Copper Button", "Copper Button"],
    ["Marigold in Motion", "Pocket Sunshine", "Pocket Sunshine"],
    ["Holly in a Hurry", "Chapter Noel", "Chapter Noel"],
    ["Gilda Curlicue", "Vera in Stride", "Gilda Curlicue"],
    ["Mittens in Motion", null, "Mittens in Motion"],
    ["Tansy Quickstep", "Tansy in Motion", "Tansy Quickstep"],
    ["Tansy Quickstep", "   ", "Tansy Quickstep"],
  ])("selects %s / %s as %s", (displayName, alternativeName, expected) => {
    const response = {
      model: request.body.model, id: "synthetic", status: "completed",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{
        type: "output_text", text: JSON.stringify({ displayName, description, tags, alternativeName }),
      }] }],
    };
    const result = parseCardMetadataResponse(response, request.body.text.format.name);
    expect(result.fields).toEqual({ displayName: expected, description, tags });
    expect(result.costUsd).toBeCloseTo(.00075);
  });

  it("uses the single-name format for a supplied name, even with a familiar ending", () => {
    const named = buildCardMetadataRequest({ prompt: "", displayName: "Mittens in Motion", nameSource: "user" }, images);
    expect(named.body.text.format.schema.required).not.toContain("alternativeName");
    expect(named.body.input[0].content[0]).toHaveProperty("text", JSON.stringify({
      name: "Mittens in Motion", nameSource: "user", characterBrief: "",
    }));
  });
});
