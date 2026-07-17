import { Children, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageViewTransition } from "@/app/YandexMetrika";

const testDoubles = vi.hoisted(() => ({
  trackPageView: vi.fn(),
  useEffect: vi.fn(),
  usePathname: vi.fn(),
  useRef: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: testDoubles.usePathname,
  useSearchParams: testDoubles.useSearchParams,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useEffect: testDoubles.useEffect,
    useRef: testDoubles.useRef,
  };
});

vi.mock("@/lib/metrics/yandex", async (importOriginal) => {
  const yandexMetrika =
    await importOriginal<typeof import("@/lib/metrics/yandex")>();

  return {
    ...yandexMetrika,
    trackPageView: testDoubles.trackPageView,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Yandex Metrika route transitions", () => {
  it("skips the initial client route effect", () => {
    expect(
      getPageViewTransition(null, "https://pets.example/gallery"),
    ).toBeNull();
  });

  it("skips a repeated full URL", () => {
    expect(
      getPageViewTransition(
        "https://pets.example/gallery?tag=otter",
        "https://pets.example/gallery?tag=otter",
      ),
    ).toBeNull();
  });

  it("returns the previous full URL as referer for a distinct URL", () => {
    expect(
      getPageViewTransition(
        "https://pets.example/gallery?tag=otter",
        "https://pets.example/gallery?tag=fox",
      ),
    ).toEqual({
      referer: "https://pets.example/gallery?tag=otter",
      url: "https://pets.example/gallery?tag=fox",
    });
  });

  it("preserves the exact full browser URL for a later route hit", async () => {
    const previousUrl =
      "https://pets.example/codex-pets/gallery?tag=previous";
    const browserHref =
      "https://pets.example/codex-pets/gallery?tag=red%20fox&language=c%2B%2B";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: browserHref,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", { title: "Encoded pets" });
    testDoubles.usePathname.mockReturnValue("/gallery");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("tag=red%20fox&language=c%2B%2B"),
    );
    testDoubles.useRef.mockReturnValue({ current: previousUrl });
    testDoubles.useEffect.mockImplementation((effect) => effect());
    vi.resetModules();

    const { default: YandexMetrika } = await import("@/app/YandexMetrika");
    const metrikaElement = YandexMetrika() as ReactElement<{
      children: React.ReactNode;
    }>;
    const suspenseElement = Children.toArray(
      metrikaElement.props.children,
    )[1] as ReactElement<{
      children: ReactElement;
    }>;
    const trackerElement = suspenseElement.props.children;

    (trackerElement.type as () => null)();

    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(browserHref, {
      referer: previousUrl,
      title: "Encoded pets",
    });
  });

  it("tracks distinct browser URLs whose parsed queries normalize equally", async () => {
    const firstHref = "https://pets.example/codex-pets/?q=red+fox";
    const secondHref = "https://pets.example/codex-pets/?q=red%20fox";
    const thirdHref = "https://pets.example/codex-pets/?q=blue+fox";
    const location = {
      href: firstHref,
      origin: "https://pets.example",
    };
    const previousUrlRef = { current: null as string | null };
    let searchParams = new URLSearchParams("q=red+fox");
    let previousDependencies: readonly unknown[] | undefined;

    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { title: "Red pets" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockImplementation(() => searchParams);
    testDoubles.useRef.mockReturnValue(previousUrlRef);
    testDoubles.useEffect.mockImplementation(
      (effect: () => void, dependencies?: readonly unknown[]) => {
        const dependenciesChanged =
          previousDependencies === undefined ||
          dependencies === undefined ||
          dependencies.length !== previousDependencies.length ||
          dependencies.some(
            (dependency, index) =>
              !Object.is(dependency, previousDependencies?.[index]),
          );

        previousDependencies = dependencies;
        if (dependenciesChanged) {
          effect();
        }
      },
    );
    vi.resetModules();

    const { default: YandexMetrika } = await import("@/app/YandexMetrika");
    const metrikaElement = YandexMetrika() as ReactElement<{
      children: React.ReactNode;
    }>;
    const suspenseElement = Children.toArray(
      metrikaElement.props.children,
    )[1] as ReactElement<{
      children: ReactElement;
    }>;
    const renderTracker = suspenseElement.props.children.type as () => null;

    renderTracker();
    expect(testDoubles.trackPageView).not.toHaveBeenCalled();

    location.href = secondHref;
    searchParams = new URLSearchParams("q=red%20fox");
    document.title = "Encoded red pets";
    renderTracker();

    location.href = thirdHref;
    searchParams = new URLSearchParams("q=blue+fox");
    document.title = "Blue pets";
    renderTracker();

    expect(testDoubles.trackPageView.mock.calls).toEqual([
      [
        secondHref,
        {
          referer: firstHref,
          title: "Encoded red pets",
        },
      ],
      [
        thirdHref,
        {
          referer: secondHref,
          title: "Blue pets",
        },
      ],
    ]);
  });
});
