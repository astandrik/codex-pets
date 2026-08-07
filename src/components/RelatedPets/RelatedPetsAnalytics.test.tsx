// @vitest-environment jsdom

import Link from "next/link";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metricsMocks = vi.hoisted(() => ({
  trackGoal: vi.fn(),
}));

vi.mock("@/lib/metrics/yandex", () => metricsMocks);

import { RelatedPetsAnalytics } from "@/components/RelatedPets/RelatedPetsAnalytics";
import { readRelatedPetAttribution } from "@/lib/metrics/related-pet-attribution";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const intersectionObservers: TestIntersectionObserver[] = [];

class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds: readonly number[];
  private readonly callback: IntersectionObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    intersectionObservers.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(target: Element, intersectionRatio: number) {
    this.callback(
      [
        {
          target,
          isIntersecting: intersectionRatio > 0,
          intersectionRatio,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  observedTargets(): Element[] {
    return [...this.targets];
  }
}

type RenderedAnalytics = {
  container: HTMLDivElement;
  root: Root;
};

let renderedAnalytics: RenderedAnalytics | undefined;

function renderAnalytics(): RenderedAnalytics {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <RelatedPetsAnalytics sourceSlug="orbit-otter">
        <article
          data-related-pet-slug="star-fox"
          data-related-pet-position="1"
        >
          <Link className="pet-card__overlay" href="/pets/star-fox">
            Star Fox
          </Link>
          <Link href="/users/fox-author">Fox Author</Link>
          <button type="button">Install</button>
        </article>
        <article
          data-related-pet-slug="terminal-cube"
          data-related-pet-position="8"
        >
          <Link className="pet-card__overlay" href="/pets/terminal-cube">
            Terminal Cube
          </Link>
        </article>
      </RelatedPetsAnalytics>,
    );
  });

  renderedAnalytics = { container, root };
  return renderedAnalytics;
}

beforeEach(() => {
  intersectionObservers.length = 0;
  metricsMocks.trackGoal.mockClear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "IntersectionObserver",
    TestIntersectionObserver as unknown as typeof IntersectionObserver,
  );
});

afterEach(() => {
  if (renderedAnalytics) {
    act(() => renderedAnalytics?.root.unmount());
    renderedAnalytics.container.remove();
    renderedAnalytics = undefined;
  }
  vi.unstubAllGlobals();
});

describe("RelatedPetsAnalytics", () => {
  it("tracks each card once after at least half of it becomes visible", () => {
    const { container } = renderAnalytics();
    const observer = intersectionObservers[0];
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-related-pet-slug]"),
    );

    expect(observer?.thresholds).toEqual([0.5]);
    expect(observer?.observedTargets()).toEqual(cards);

    act(() => observer?.trigger(cards[0]!, 0.49));
    expect(metricsMocks.trackGoal).not.toHaveBeenCalled();

    act(() => observer?.trigger(cards[0]!, 0.5));
    expect(metricsMocks.trackGoal).toHaveBeenCalledWith(
      "related_pet_impression",
      {
        source_slug: "orbit-otter",
        target_slug: "star-fox",
        position: 1,
        surface: "pet_detail",
      },
    );

    act(() => observer?.trigger(cards[0]!, 1));
    expect(metricsMocks.trackGoal).toHaveBeenCalledTimes(1);

    act(() => observer?.trigger(cards[1]!, 0.75));
    expect(metricsMocks.trackGoal).toHaveBeenLastCalledWith(
      "related_pet_impression",
      {
        source_slug: "orbit-otter",
        target_slug: "terminal-cube",
        position: 8,
        surface: "pet_detail",
      },
    );
  });

  it("tracks only navigation from the related pet overlay", () => {
    const { container } = renderAnalytics();
    const overlay = container.querySelector<HTMLAnchorElement>(
      ".pet-card__overlay",
    );
    const author = container.querySelector<HTMLAnchorElement>(
      'a[href="/users/fox-author"]',
    );
    const install = container.querySelector<HTMLButtonElement>("button");

    overlay?.addEventListener("click", (event) => event.preventDefault());
    author?.addEventListener("click", (event) => event.preventDefault());

    act(() => author?.click());
    act(() => install?.click());
    expect(metricsMocks.trackGoal).not.toHaveBeenCalled();

    act(() => overlay?.click());
    expect(metricsMocks.trackGoal).toHaveBeenCalledOnce();
    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("related_pet_click", {
      source_slug: "orbit-otter",
      target_slug: "star-fox",
      position: 1,
      surface: "pet_detail",
    });
    expect(readRelatedPetAttribution("star-fox")).toEqual({
      sourceSlug: "orbit-otter",
      targetSlug: "star-fox",
      position: 1,
    });
  });
});
