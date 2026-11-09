// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HomeHeroPetPicker,
  type HomeHeroPet,
} from "@/components/HomePage/HomeHeroPetPicker";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    width,
    height,
    className,
    draggable,
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      width={width}
      height={height}
      className={className}
      draggable={draggable}
    />
  ),
}));
vi.mock("@/lib/metrics/yandex", () => ({
  trackGoal: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("HomeHeroPetPicker install command", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const writeText = vi.fn().mockResolvedValue(undefined);
  const pets: HomeHeroPet[] = ["ravensteel", "silver-wink"].map((slug) => ({
    slug,
    displayName: slug,
    description: "A coding companion.",
    kind: "creature",
    ownerName: null,
    ownerProfileSlug: null,
    publicAuthorEmail: null,
    spritesheetUrl: `/api/assets/${slug}/spritesheet.webp`,
  }));

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("copies the selected pet's full command and updates it after shuffling", async () => {
    act(() => root.render(<HomeHeroPetPicker pets={pets} initialIndex={0} />));

    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy install command for ravensteel"]',
    );
    expect(copy).not.toBeNull();
    await act(async () => copy!.click());
    expect(writeText).toHaveBeenLastCalledWith(
      "npx @astandrik/codex-pets install ravensteel",
    );
    expect(copy!.textContent).toContain("Copied");
    expect(
      container.querySelector(".home-hero-pet__actions a")?.getAttribute("href"),
    ).toBe("/pets/ravensteel");

    const shuffle = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("I'm feeling lucky"));
    act(() => shuffle!.click());

    const nextCopy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy install command for silver-wink"]',
    );
    expect(nextCopy).not.toBeNull();
    expect(nextCopy!.textContent).toContain("Copy");
    expect(nextCopy!.textContent).not.toContain("Copied");
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => nextCopy!.click());
    expect(writeText).toHaveBeenLastCalledWith(
      "npx @astandrik/codex-pets install silver-wink",
    );
    expect(
      container.querySelector(".home-hero-pet__actions a")?.getAttribute("href"),
    ).toBe("/pets/silver-wink");
    expect(container.querySelector('[data-pet-poster]')?.getAttribute("src"))
      .toBe("/pets/silver-wink/preview.webp");
  });

  it("keeps copying available for a single pet and hides it for the empty fallback", async () => {
    act(() => root.render(
      <HomeHeroPetPicker pets={pets.slice(0, 1)} initialIndex={0} />,
    ));
    const shuffle = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("I'm feeling lucky"));
    expect(shuffle?.disabled).toBe(true);
    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Copy install command"]',
    );
    expect(copy?.disabled).toBe(false);
    await act(async () => copy!.click());
    expect(writeText).toHaveBeenCalledWith(
      "npx @astandrik/codex-pets install ravensteel",
    );

    act(() => root.render(<HomeHeroPetPicker pets={[]} initialIndex={0} />));
    expect(container.querySelector('button[aria-label^="Copy install command"]')).toBeNull();
  });

  it.each(["error", "load"])("starts a fresh image attempt when shuffling A → B → A after %s", (event) => {
    act(() => root.render(<HomeHeroPetPicker pets={pets} initialIndex={0} />));
    const image = container.querySelector(event === "error" ? "[data-pet-poster]" : ".home-hero-pet__sprite-strip");
    act(() => image!.dispatchEvent(new Event(event)));
    const shuffle = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("I'm feeling lucky"))!;
    act(() => shuffle.click());
    act(() => shuffle.click());
    const poster = container.querySelector<HTMLImageElement>("[data-pet-poster]");
    expect(poster?.getAttribute("src")).toBe("/pets/ravensteel/preview.webp");
    expect(poster?.style.visibility).toBe("");
    expect(container.querySelector<HTMLImageElement>(".home-hero-pet__sprite-strip")?.style.visibility).toBe("hidden");
  });

  it("retains the legacy atlas fallback if a public poster is unavailable", () => {
    const externalPet = { ...pets[0], spritesheetUrl: "https://assets.example/atlas.png" };
    act(() => root.render(<HomeHeroPetPicker pets={[externalPet]} initialIndex={0} />));
    expect(container.querySelector(".home-hero-pet__sprite-frame")).toBeNull();
    act(() => container.querySelector("[data-pet-poster]")!.dispatchEvent(new Event("error")));
    expect(container.querySelector<HTMLElement>(".home-hero-pet__sprite-frame")?.style.backgroundImage)
      .toContain(externalPet.spritesheetUrl);
  });
});
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
    expect(container.querySelector('img[data-pet-poster]')?.getAttribute("src"))
      .toBe("/pets/boba/preview.webp");

    expect(
      container.querySelector('a[href="mailto:creator+public@example.com"]')
        ?.textContent,
    ).toBe("creator+public@example.com");
    expect(container.querySelector<HTMLElement>(".home-hero-pet__sprite-viewport")?.style.getPropertyValue("--home-hero-frame-duration")).toBe("6600ms");
  });
});
