// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metricsMocks = vi.hoisted(() => ({
  trackGoal: vi.fn(),
}));

vi.mock("@/lib/metrics/yandex", () => metricsMocks);
vi.mock("@gravity-ui/uikit", () => ({
  useToaster: () => ({ add: vi.fn() }),
}));

import { PetCardMetrics } from "@/components/PetCard/PetCardMetrics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  metricsMocks.trackGoal.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderMetrics(related: boolean) {
  act(() =>
    root.render(
      <PetCardMetrics
        slug="star-fox"
        displayName="Star Fox"
        status="approved"
        likeCount={1}
        downloadCount={2}
        installCount={3}
        relatedContext={
          related
            ? {
                sourceSlug: "orbit-otter",
                targetSlug: "star-fox",
                position: 8,
              }
            : undefined
        }
      />,
    ),
  );
}

describe("PetCardMetrics download attribution", () => {
  it("adds direct related context", () => {
    renderMetrics(true);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[title="Download ZIP"]',
    );
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "card",
      source_slug: "orbit-otter",
      target_slug: "star-fox",
      position: 8,
      origin: "related_pet",
    });
  });

  it("keeps the ordinary card contract unchanged", () => {
    renderMetrics(false);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[title="Download ZIP"]',
    );
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "card",
    });
  });
});
