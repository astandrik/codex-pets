// @vitest-environment jsdom

import { act, type ReactNode } from "react";
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
    onClick,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

import { InstallCommandButton } from "@/components/InstallCommand/InstallCommandButton";

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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function clickCopy() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>("button")?.click();
    await Promise.resolve();
  });
}

describe("InstallCommandButton related attribution", () => {
  it("adds direct related context on a card", async () => {
    act(() =>
      root.render(
        <InstallCommandButton
          slug="star-fox"
          surface="card"
          relatedContext={{
            sourceSlug: "orbit-otter",
            targetSlug: "star-fox",
            position: 8,
          }}
        />,
      ),
    );

    await clickCopy();

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith(
      "pet_install_command_copy",
      {
        slug: "star-fox",
        surface: "card",
        source_slug: "orbit-otter",
        target_slug: "star-fox",
        position: 8,
        origin: "related_pet",
      },
    );
  });

  it("reads a matching stored context on detail", async () => {
    storeRelatedPetAttribution({
      sourceSlug: "orbit-otter",
      targetSlug: "star-fox",
      position: 5,
    });
    act(() =>
      root.render(<InstallCommandButton slug="star-fox" surface="detail" />),
    );

    await clickCopy();

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith(
      "pet_install_command_copy",
      expect.objectContaining({
        slug: "star-fox",
        surface: "detail",
        source_slug: "orbit-otter",
        target_slug: "star-fox",
        position: 5,
        origin: "related_pet",
      }),
    );
  });

  it("keeps the ordinary card contract unchanged", async () => {
    act(() =>
      root.render(<InstallCommandButton slug="star-fox" surface="card" />),
    );

    await clickCopy();

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith(
      "pet_install_command_copy",
      { slug: "star-fox", surface: "card" },
    );
  });
});
