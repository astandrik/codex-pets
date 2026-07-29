// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";
import { withBasePath } from "@/lib/base-path";

describe("not-found page", () => {
  function renderNotFound() {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<NotFound />);
    return container;
  }

  it("shows branded 404 copy as a top-level heading", () => {
    const container = renderNotFound();

    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toContain("404 — page not found");
  });

  it("links back to the gallery and the flagship guide", () => {
    const container = renderNotFound();

    expect(container.querySelector(`a[href="${withBasePath("/")}"]`)).not.toBeNull();
    expect(
      container.querySelector(
        `a[href="${withBasePath("/guides/best-codex-pets-for-ai-coding-agents")}"]`,
      ),
    ).not.toBeNull();
  });
});
