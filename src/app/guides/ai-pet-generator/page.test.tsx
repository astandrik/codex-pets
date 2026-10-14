// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Guide, { metadata } from "./page";
import { GET } from "@/app/guides/ai-pet-generator.md/route";
import { AI_PET_GENERATOR_SECTIONS, getAiPetGeneratorJsonLd } from "@/lib/guides/ai-pet-generator";

describe("public generator guide", () => {
  it("provides indexable canonical article metadata without private capabilities", () => {
    expect(metadata.robots).toEqual({ index:true, follow:true });
    expect(metadata.alternates?.canonical).toBe("/guides/ai-pet-generator");
    expect(getAiPetGeneratorJsonLd()).toMatchObject({"@type":"Article",headline:"AI pet generator for Codex"});
    expect(JSON.stringify(metadata)).not.toContain("/generated/");
  });
  it("renders the same important terms in HTML and Markdown", async () => {
    const root=document.createElement("div");root.innerHTML=renderToStaticMarkup(createElement(Guide));
    const markdown=await (GET()).text();
    for(const section of AI_PET_GENERATOR_SECTIONS){
      expect(root.textContent).toContain(section.title);
      for(const text of section.paragraphs){expect(root.textContent).toContain(text);expect(markdown).toContain(text);}
    }
    expect(root.querySelector('a[href="/generate"]')?.textContent).toContain("Generate a pet");
    expect(root.querySelector('a[href="/request"]')).not.toBeNull();
    expect(root.querySelector('a[href^="/generated/"]')).toBeNull();
    expect(root.textContent).toContain("Generation is experimental");
    expect(root.textContent).toContain("24 hours after the task is accepted");
    expect(root.textContent).toContain("only after approval");
  });
});
