// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {compile} from "sass";
import {fileURLToPath} from "node:url";

import {HomePage} from "./HomePage";
import {AskAIPanel} from "@/components/AskAI/AskAIPanel";
import {ASK_AI_HOME, ASK_AI_PRODUCT_NAME} from "@/components/AskAI/ask-ai-content";

const styles = [
  "../AskAI/AskAIPanel.scss",
  "./HomePage.scss",
].map(path => compile(fileURLToPath(new URL(path, import.meta.url))).css).join("\n");

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function renderAtWidth(width: number, theme: string, enabled = true) {
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.append(style);
  // JSDOM has no layout or viewport media evaluation. Apply the stylesheet's
  // matching max-width rules; real element bounds are checked in the browser.
  const activeMedia = Array.from(style.sheet!.cssRules).flatMap(rule => {
    if (!(rule instanceof CSSMediaRule)) return [];
    const maxWidth = rule.conditionText.match(/^\(max-width:\s*(\d+)px\)$/);
    return maxWidth && width <= Number(maxWidth[1])
      ? Array.from(rule.cssRules, nested => nested.cssText)
      : [];
  });
  const mediaStyle = document.createElement("style");
  mediaStyle.textContent = activeMedia.join("\n");
  document.head.append(mediaStyle);
  document.body.className = `g-root g-root_theme_${theme}`;
  document.body.innerHTML = renderToStaticMarkup(
    <HomePage pets={[]} totalPets={0} catalogTotalPets={0} showLandingContent
      generationAvailable={enabled} catalog={<div>catalog</div>}/>,
  );
}

describe.each(["dark", "light"])("home layout in %s theme", theme => {
  it.each([1280, 390, 320])("keeps all provider names visually exposed at %i px", width => {
    renderAtWidth(width, theme);
    const links = document.querySelectorAll(".ask-ai-panel__link");
    expect(links).toHaveLength(5);
    for (const link of links) {
      const text = link.querySelector(".ask-ai-panel__link-text")!;
      const labelStyle = getComputedStyle(text);
      expect(text.textContent?.trim()).not.toBe("");
      expect(labelStyle.width).not.toBe("1px");
      expect(labelStyle.height).not.toBe("1px");
      expect(labelStyle.display).not.toBe("none");
      expect(labelStyle.visibility).not.toBe("hidden");
      expect(labelStyle.clip).toBe("auto");
      expect(Number.parseFloat(getComputedStyle(link).minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it.each([true, false])("lets narrow hero actions wrap with generation enabled=%s", enabled => {
    renderAtWidth(320, theme, enabled);
    const actions = document.querySelector(".home-hero__actions")!;
    const actionStyle = getComputedStyle(actions);
    expect(actionStyle.flexWrap === "wrap" || actionStyle.flexDirection === "column").toBe(true);
    const disabled = actions.querySelector("button:disabled");
    expect(Boolean(disabled)).toBe(!enabled);
  });
});

it("preserves visible icons and compact buttons for other Ask AI consumers", () => {
  renderAtWidth(1280, "dark");
  document.body.innerHTML = renderToStaticMarkup(
    <AskAIPanel productName={ASK_AI_PRODUCT_NAME} label={ASK_AI_HOME.label}
      helperText={ASK_AI_HOME.helperText} prompt={ASK_AI_HOME.prompt}
      page="agents" promptVariant="agents"/>,
  );
  const link = document.querySelector(".ask-ai-panel__link")!;
  expect(getComputedStyle(link.querySelector("svg")!).display).not.toBe("none");
  expect(getComputedStyle(link).width).toBe("44px");
});
