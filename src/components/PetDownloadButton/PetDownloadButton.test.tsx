// @vitest-environment jsdom

import { act, type MouseEventHandler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeRelatedPetAttribution } from "@/lib/metrics/related-pet-attribution";

const metricsMocks = vi.hoisted(() => ({
  trackGoal: vi.fn(),
}));

vi.mock("@/lib/metrics/yandex", () => metricsMocks);
vi.mock("@/components/GravityUI/GravityUI", () => ({
  Button: ({
    children,
    href,
    onClick,
  }: {
    children: ReactNode;
    href: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

import { PetDownloadButton } from "@/components/PetDownloadButton/PetDownloadButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.sessionStorage.clear();
  metricsMocks.trackGoal.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PetDownloadButton", () => {
  it("attributes a detail download after related navigation", () => {
    storeRelatedPetAttribution({
      sourceSlug: "orbit-otter",
      targetSlug: "star-fox",
      position: 6,
    });
    act(() => root.render(<PetDownloadButton slug="star-fox" />));
    const link = container.querySelector<HTMLAnchorElement>("a");
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "detail",
      source_slug: "orbit-otter",
      target_slug: "star-fox",
      position: 6,
      origin: "related_pet",
    });
  });

  it("keeps an ordinary detail download un-attributed", () => {
    act(() => root.render(<PetDownloadButton slug="star-fox" />));
    const link = container.querySelector<HTMLAnchorElement>("a");
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "detail",
    });
  });
});
