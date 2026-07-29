// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("not-found page", () => {
  function renderNotFound() {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<NotFound />);
    return container;
  }

  it("shows branded 404 copy", () => {
    const container = renderNotFound();

    expect(container.textContent).toContain("404");
    expect(container.textContent).toContain("page not found");
  });

  it("links back to the gallery and the flagship guide", () => {
    const container = renderNotFound();

    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(
      container.querySelector(
        'a[href="/guides/best-codex-pets-for-ai-coding-agents"]',
      ),
    ).not.toBeNull();
  });
});
