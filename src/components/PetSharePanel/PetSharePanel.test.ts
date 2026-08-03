// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PetSharePanel } from "@/components/PetSharePanel/PetSharePanel";
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
};

let renderedPanel: RenderedPanel | undefined;

function renderPanel(): RenderedPanel {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(PetSharePanel, {
        slug: "orbit-otter",
        source,
      }),
    );
  });

  renderedPanel = { container, root };
  return renderedPanel;
}

function getDisclosureTrigger(container: HTMLElement): HTMLButtonElement {
  const trigger = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Embed & share"),
  );

  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("Embed & share disclosure trigger not rendered");
  }

  return trigger;
}

function pressDisclosureTrigger(
  trigger: HTMLButtonElement,
  key: "Enter" | " ",
): void {
  act(() => {
    trigger.focus();
    const keyDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    });

    trigger.dispatchEvent(keyDown);
    if (!keyDown.defaultPrevented) {
      trigger.click();
    }
    trigger.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        key,
      }),
    );
  });
}

afterEach(() => {
  if (renderedPanel) {
    act(() => {
      renderedPanel?.root.unmount();
    });
    renderedPanel.container.remove();
    renderedPanel = undefined;
  }
});

describe("PetSharePanel disclosure", () => {
  it("renders the embed tools collapsed behind an accessible trigger", () => {
    const { container } = renderPanel();
    const trigger = getDisclosureTrigger(container);
    const details = container.querySelector<HTMLElement>('[role="region"]');

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.closest("h2")).not.toBeNull();
    expect(details).not.toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe(details?.id);
    expect(details?.classList.contains("g-disclosure__content_visible")).toBe(
      false,
    );

    act(() => {
      trigger.click();
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(details?.classList.contains("g-disclosure__content_visible")).toBe(
      true,
    );
    expect(details?.textContent).toContain("README badge");
  });

  it("toggles the disclosure with keyboard activation", () => {
    const { container } = renderPanel();
    const trigger = getDisclosureTrigger(container);

    pressDisclosureTrigger(trigger, "Enter");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    pressDisclosureTrigger(trigger, " ");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves animation and scale choices after collapsing", () => {
    const { container } = renderPanel();
    const trigger = getDisclosureTrigger(container);

    act(() => {
      trigger.click();
    });

    const stateSelect = container.querySelector<HTMLSelectElement>("select");
    const scaleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "3x",
    );

    expect(stateSelect).not.toBeNull();
    expect(scaleButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      if (stateSelect) {
        stateSelect.value = "review";
        stateSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      scaleButton?.click();
    });

    act(() => {
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    expect(stateSelect?.value).toBe("review");
    expect(scaleButton?.classList.contains("pet-share-panel__segment_active")).toBe(
      true,
    );
  });
});

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
