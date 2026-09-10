// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PetCard } from "@/components/PetCard/PetCard";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt ?? ""} />
  ),
}));
vi.mock("@/components/InstallCommand/InstallCommandButton", () => ({
  InstallCommandButton: () => null,
}));
vi.mock("@/components/PetCard/PetCardMetrics", () => ({
  PetCardMetrics: () => null,
}));

describe("PetCard public author email", () => {
  it("renders the approved public address as a mailto link", () => {
    const markup = renderToStaticMarkup(
      <PetCard
        pet={{
          id: "pet_1",
          slug: "boba",
          displayName: "Boba",
          description: "Round coding companion.",
          spritesheetUrl: "/api/assets/a/spritesheet.webp",
          petJsonUrl: "/api/assets/a/pet.json",
          zipUrl: "/api/assets/a/pet.zip",
          spritesheetExt: "webp",
          kind: "creature",
          tags: ["round"],
          status: "approved",
          ownerName: "Creator",
          ownerProfileSlug: null,
          ownerAvatarUrl: null,
          publicAuthorEmail: "creator+public@example.com",
          createdAt: "2026-05-01T00:00:00.000Z",
          approvedAt: "2026-05-02T00:00:00.000Z",
          downloadCount: 0,
          installCount: 0,
          likeCount: 0,
        }}
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
