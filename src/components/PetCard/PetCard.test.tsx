// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PetCard } from "@/components/PetCard/PetCard";
import { RelatedPets } from "@/components/RelatedPets/RelatedPets";
import { listMockPetRecords } from "@/lib/pets/mock-data";

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
  it("renders the approved public address and a 6.6-second idle loop", () => {
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
    expect(container.querySelector('img[data-pet-poster]')?.getAttribute("src"))
      .toBe("/pets/boba/preview.webp");
    expect(container.querySelector<HTMLElement>(".pet-card__sprite-viewport")?.style.getPropertyValue("--pet-card-frame-duration")).toBe("6600ms");

    expect(
      container.querySelector('a[href="mailto:creator+public@example.com"]')
        ?.textContent,
    ).toBe("creator+public@example.com");
  });
});

it.each(["pending", "rejected", "deleted"] as const)("does not request a public poster for a %s pet", (status) => {
  const pet = listMockPetRecords()[0];
  const markup = renderToStaticMarkup(<PetCard pet={{ ...pet, ...pet.metrics, status }} />);
  const container = document.createElement("div");
  container.innerHTML = markup;
  expect(container.querySelector("[data-pet-poster]")).toBeNull();
  expect(container.querySelector(".pet-card__sprite-strip")?.getAttribute("src"))
    .toContain("/idle-strip.webp");
});

it("includes crawlable posters in the related-pets server markup", () => {
  const pet = listMockPetRecords()[0];
  const markup = renderToStaticMarkup(<RelatedPets pets={[{ ...pet, ...pet.metrics }]} sourceSlug="another" />);
  const container = document.createElement("div");
  container.innerHTML = markup;
  expect(container.querySelector(".related-pets [data-pet-poster]")?.getAttribute("src"))
    .toBe(`/pets/${pet.slug}/preview.webp`);
});
