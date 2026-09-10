// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PetMetaList } from "@/components/PetDetails/PetMetaList";

describe("PetMetaList public author email", () => {
  it("renders the approved public address as a mailto link", () => {
    const markup = renderToStaticMarkup(
      <PetMetaList
        slug="boba"
        kind="creature"
        ownerName="Creator"
        ownerProfileSlug={null}
        publicAuthorEmail="creator+public@example.com"
        createdAt="2026-05-01T00:00:00.000Z"
        approvedAt="2026-05-02T00:00:00.000Z"
        tags={["round"]}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    const link = container.querySelector(
      'a[href="mailto:creator+public@example.com"]',
    );
    expect(link?.textContent).toBe("creator+public@example.com");
  });
});
