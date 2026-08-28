// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HomeHeroPetPicker } from "@/components/HomePage/HomeHeroPetPicker";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt ?? ""} />
  ),
}));
vi.mock("@/lib/metrics/yandex", () => ({
  trackGoal: vi.fn(),
}));

describe("HomeHeroPetPicker public author email", () => {
  it("renders the approved public address as a mailto link", () => {
    const markup = renderToStaticMarkup(
      <HomeHeroPetPicker
        initialIndex={0}
        pets={[
          {
            slug: "boba",
            displayName: "Boba",
            description: "Round coding companion.",
            kind: "creature",
            ownerName: "Creator",
            ownerProfileSlug: null,
            publicAuthorEmail: "creator+public@example.com",
            spritesheetUrl: "/api/assets/a/spritesheet.webp",
          },
        ]}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    expect(
      container.querySelector('a[href="mailto:creator+public@example.com"]')
        ?.textContent,
    ).toBe("creator+public@example.com");
  });
});
