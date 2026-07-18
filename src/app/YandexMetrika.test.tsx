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

async function loadRouteTrackerRender(): Promise<() => null> {
  const { default: YandexMetrika } = await import("@/app/YandexMetrika");
  const metrikaElement = YandexMetrika() as ReactElement<{
    children: React.ReactNode;
  }>;
  const suspenseElement = Children.toArray(
    metrikaElement.props.children,
  )[1] as ReactElement<{
    children: ReactElement;
  }>;

  return suspenseElement.props.children.type as () => null;
}

function installMutationObserverHarness() {
  const pageViewMetadataAttributes = new Map<string, string>([
    ["name", "codex-pets-page-view"],
  ]);
  const pageViewMetadataElement = {
    getAttribute(name: string) {
      return pageViewMetadataAttributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      pageViewMetadataAttributes.set(name, value);
    },
    tagName: "META",
  } as unknown as HTMLMetaElement;
  const observers: Array<{
    active: boolean;
    callback: MutationCallback;
    instance: MutationObserver;
    records: MutationRecord[];
  }> = [];

  class MutationObserverDouble implements MutationObserver {
    private readonly record: (typeof observers)[number];

    constructor(callback: MutationCallback) {
      this.record = {
        active: true,
        callback,
        instance: this,
        records: [],
      };
      observers.push(this.record);
    }

    disconnect() {
      this.record.active = false;
      this.record.records = [];
    }

    observe() {}

    takeRecords(): MutationRecord[] {
      return this.record.records.splice(0);
    }
  }

  vi.stubGlobal("MutationObserver", MutationObserverDouble);

  return {
    commitTitle(title: string) {
      document.title = title;
      for (const observer of observers) {
        if (observer.active) {
          const records = observer.records.splice(0);
          observer.callback(records, observer.instance);
        }
      }
    },
    flushQueuedTitles() {
      for (const observer of observers) {
        if (observer.active && observer.records.length > 0) {
          const records = observer.records.splice(0);
          observer.callback(records, observer.instance);
        }
      }
    },
    getPageViewMetadataElement() {
      return pageViewMetadataElement;
    },
    queuePageViewMetadata(url: string, title: string) {
      const pageViewUrl = new URL(url);
      const content = JSON.stringify({
        title,
        url: `${pageViewUrl.pathname}${pageViewUrl.search}`,
      });
      const oldValue = pageViewMetadataElement.getAttribute("content");
      pageViewMetadataElement.setAttribute("content", content);
      document.title = title;

      for (const observer of observers) {
        if (observer.active) {
          observer.records.push({
            attributeName: "content",
            oldValue,
            target: pageViewMetadataElement,
            type: "attributes",
          } as unknown as MutationRecord);
        }
      }
    },
    queueTitle(title: string) {
      document.title = title;
      for (const observer of observers) {
        if (observer.active) {
          observer.records.push({} as MutationRecord);
        }
      }
    },
    setPageViewMetadata(url: string, title: string) {
      const pageViewUrl = new URL(url);
      pageViewMetadataElement.setAttribute(
        "content",
        JSON.stringify({
          title,
          url: `${pageViewUrl.pathname}${pageViewUrl.search}`,
        }),
      );
    },
  };
}

function installEffectHarness() {
  const effects: Array<{
    cleanup?: () => void;
    dependencies?: readonly unknown[];
  }> = [];
  let effectIndex = 0;

  testDoubles.useEffect.mockImplementation(
    (effect: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const currentEffectIndex = effectIndex;
      effectIndex += 1;
      const previousEffect = effects[currentEffectIndex];
      const dependenciesChanged =
        previousEffect === undefined ||
        dependencies === undefined ||
        previousEffect.dependencies === undefined ||
        dependencies.length !== previousEffect.dependencies.length ||
        dependencies.some(
          (dependency, index) =>
            !Object.is(dependency, previousEffect.dependencies?.[index]),
        );

      if (!dependenciesChanged) {
        return;
      }

      previousEffect?.cleanup?.();
      const cleanup = effect();
      effects[currentEffectIndex] = {
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
        dependencies: dependencies ? [...dependencies] : undefined,
      };
    },
  );

  return {
    render(renderTracker: () => null) {
      effectIndex = 0;
      renderTracker();
    },
    unmount() {
      for (const effect of effects) {
        effect.cleanup?.();
      }
      effects.length = 0;
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    vi.useFakeTimers();
    installMutationObserverHarness();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: browserHref,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", { head: {}, title: "Encoded pets" });
    testDoubles.usePathname.mockReturnValue("/gallery");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("tag=red%20fox&language=c%2B%2B"),
    );
    testDoubles.useRef.mockReturnValue({
      current: {
        title: "Previous pets",
        url: previousUrl,
      },
    });
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
    vi.advanceTimersByTime(250);

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
    const pageViewStateRef = {
      current: {
        title: "",
        url: null as string | null,
      },
    };
    let searchParams = new URLSearchParams("q=red+fox");
    const effectHarness = installEffectHarness();

    vi.useFakeTimers();
    installMutationObserverHarness();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { head: {}, title: "Red pets" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockImplementation(() => searchParams);
    testDoubles.useRef.mockReturnValue(pageViewStateRef);
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

    effectHarness.render(renderTracker);
    expect(testDoubles.trackPageView).not.toHaveBeenCalled();

    location.href = secondHref;
    searchParams = new URLSearchParams("q=red%20fox");
    document.title = "Encoded red pets";
    effectHarness.render(renderTracker);

    location.href = thirdHref;
    searchParams = new URLSearchParams("q=blue+fox");
    document.title = "Blue pets";
    effectHarness.render(renderTracker);
    vi.advanceTimersByTime(250);

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

  it("waits for the destination title before sending a route hit", async () => {
    const previousUrl = "https://pets.example/codex-pets/?q=previous";
    const destinationUrl = "https://pets.example/codex-pets/?q=red%20fox";
    const titleObserver = installMutationObserverHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: destinationUrl,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", { head: {}, title: "" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("q=red%20fox"),
    );
    testDoubles.useRef.mockReturnValue({
      current: {
        title: 'Codex pets matching "previous"',
        url: previousUrl,
      },
    });
    testDoubles.useEffect.mockImplementation((effect) => effect());
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    renderTracker();

    expect(testDoubles.trackPageView).not.toHaveBeenCalled();

    titleObserver.commitTitle('Codex pets matching "red fox"');
    vi.advanceTimersByTime(250);

    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(destinationUrl, {
      referer: previousUrl,
      title: 'Codex pets matching "red fox"',
    });
  });

  it("correlates base-path homepage metadata with the canonical browser URL", async () => {
    const previousUrl = "https://pets.example/codex-pets?q=previous";
    const destinationUrl =
      "https://pets.example/codex-pets?q=red%20fox";
    const destinationTitle = 'Codex pets matching "red fox"';
    const titleObserver = installMutationObserverHarness();
    const pageViewMetadataElement =
      titleObserver.getPageViewMetadataElement();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    vi.stubGlobal("window", {
      location: {
        href: destinationUrl,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", {
      head: {},
      querySelector: (selector: string) =>
        selector === 'meta[name="codex-pets-page-view"]'
          ? pageViewMetadataElement
          : null,
      title: destinationTitle,
    });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("q=red%20fox"),
    );
    testDoubles.useRef.mockReturnValue({
      current: {
        title: 'Codex pets matching "previous"',
        url: previousUrl,
      },
    });
    testDoubles.useEffect.mockImplementation((effect) => effect());
    vi.resetModules();

    const { getPageViewOtherMetadata } = await import(
      "@/lib/site-metadata"
    );
    const metadataContent = getPageViewOtherMetadata(
      "/?q=red+fox",
      destinationTitle,
      { applyTitleTemplate: false },
    )["codex-pets-page-view"];
    expect(metadataContent).toBeTypeOf("string");
    pageViewMetadataElement.setAttribute(
      "content",
      metadataContent as string,
    );

    const renderTracker = await loadRouteTrackerRender();
    renderTracker();

    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(destinationUrl, {
      referer: previousUrl,
      title: destinationTitle,
    });
  });

  it("waits for the destination title to settle before sending a route hit", async () => {
    const previousUrl = "https://pets.example/codex-pets/?q=previous";
    const destinationUrl = "https://pets.example/codex-pets/?q=red%20fox";
    const titleObserver = installMutationObserverHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: destinationUrl,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", { head: {}, title: "Codex Pets" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("q=red%20fox"),
    );
    testDoubles.useRef.mockReturnValue({
      current: {
        title: 'Codex pets matching "previous"',
        url: previousUrl,
      },
    });
    testDoubles.useEffect.mockImplementation((effect) => effect());
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    renderTracker();

    vi.advanceTimersByTime(200);
    titleObserver.commitTitle('Codex pets matching "red fox"');

    vi.advanceTimersByTime(249);
    expect(testDoubles.trackPageView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(destinationUrl, {
      referer: previousUrl,
      title: 'Codex pets matching "red fox"',
    });
  });

  it("tracks every navigation when a pending title wait is superseded", async () => {
    const firstUrl = "https://pets.example/codex-pets/?q=previous";
    const supersededUrl = "https://pets.example/codex-pets/?q=red%20fox";
    const finalUrl = "https://pets.example/codex-pets/?q=blue%20fox";
    const location = {
      href: supersededUrl,
      origin: "https://pets.example",
    };
    const titleObserver = installMutationObserverHarness();
    const pageViewStateRef = {
      current: {
        title: 'Codex pets matching "previous"',
        url: firstUrl,
      },
    };
    let searchParams = new URLSearchParams("q=red%20fox");
    const effectHarness = installEffectHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { head: {}, title: "" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockImplementation(() => searchParams);
    testDoubles.useRef.mockReturnValue(pageViewStateRef);
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    effectHarness.render(renderTracker);

    titleObserver.commitTitle('Codex pets matching "red fox"');

    location.href = finalUrl;
    searchParams = new URLSearchParams("q=blue%20fox");
    effectHarness.render(renderTracker);

    expect(testDoubles.trackPageView.mock.calls).toEqual([
      [
        supersededUrl,
        {
          referer: firstUrl,
          title: 'Codex pets matching "red fox"',
        },
      ],
    ]);

    vi.advanceTimersByTime(250);
    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();

    titleObserver.commitTitle('Codex pets matching "blue fox"');

    vi.advanceTimersByTime(249);
    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);

    expect(testDoubles.trackPageView.mock.calls).toEqual([
      [
        supersededUrl,
        {
          referer: firstUrl,
          title: 'Codex pets matching "red fox"',
        },
      ],
      [
        finalUrl,
        {
          referer: supersededUrl,
          title: 'Codex pets matching "blue fox"',
        },
      ],
    ]);

    vi.advanceTimersByTime(5_000);
    expect(testDoubles.trackPageView).toHaveBeenCalledTimes(2);
  });

  it.each([
    "before the next URL",
    "after the next URL but before its effect",
    "after the next effect",
  ] as const)(
    "keeps a superseded navigation pending when its title arrives %s",
    async (titleTiming) => {
      const firstUrl = "https://pets.example/codex-pets/?q=previous";
      const supersededUrl =
        "https://pets.example/codex-pets/?q=red%20fox";
      const finalUrl =
        "https://pets.example/codex-pets/?q=blue%20fox";
      const location = {
        href: supersededUrl,
        origin: "https://pets.example",
      };
      const titleObserver = installMutationObserverHarness();
      const pageViewStateRef = {
        current: {
          title: 'Codex pets matching "previous"',
          url: firstUrl,
        },
      };
      let searchParams = new URLSearchParams("q=red%20fox");
      const effectHarness = installEffectHarness();

      vi.useFakeTimers();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubGlobal("window", { location });
      vi.stubGlobal("document", {
        head: {},
        title: 'Codex pets matching "previous"',
      });
      testDoubles.usePathname.mockReturnValue("/");
      testDoubles.useSearchParams.mockImplementation(() => searchParams);
      testDoubles.useRef.mockReturnValue(pageViewStateRef);
      vi.resetModules();

      const renderTracker = await loadRouteTrackerRender();
      effectHarness.render(renderTracker);

      if (titleTiming === "before the next URL") {
        titleObserver.queueTitle('Codex pets matching "red fox"');
      }

      location.href = finalUrl;
      if (titleTiming === "after the next URL but before its effect") {
        titleObserver.queueTitle('Codex pets matching "red fox"');
      }

      searchParams = new URLSearchParams("q=blue%20fox");
      effectHarness.render(renderTracker);

      if (titleTiming === "after the next effect") {
        titleObserver.queueTitle('Codex pets matching "red fox"');
      }
      titleObserver.flushQueuedTitles();
      vi.advanceTimersByTime(250);

      titleObserver.commitTitle('Codex pets matching "blue fox"');
      vi.advanceTimersByTime(249);
      expect(testDoubles.trackPageView).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1);

      expect(testDoubles.trackPageView.mock.calls).toEqual([
        [
          supersededUrl,
          {
            referer: firstUrl,
            title: 'Codex pets matching "red fox"',
          },
        ],
        [
          finalUrl,
          {
            referer: supersededUrl,
            title: 'Codex pets matching "blue fox"',
          },
        ],
      ]);

      vi.advanceTimersByTime(5_000);
      expect(testDoubles.trackPageView).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps repeated superseded navigations in URL order", async () => {
    const firstUrl = "https://pets.example/codex-pets/?q=a";
    const secondUrl = "https://pets.example/codex-pets/?q=b";
    const thirdUrl = "https://pets.example/codex-pets/?q=c";
    const fourthUrl = "https://pets.example/codex-pets/?q=d";
    const location = {
      href: secondUrl,
      origin: "https://pets.example",
    };
    const titleObserver = installMutationObserverHarness();
    const pageViewStateRef = {
      current: {
        title: "Title A",
        url: firstUrl,
      },
    };
    let searchParams = new URLSearchParams("q=b");
    const effectHarness = installEffectHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { head: {}, title: "Title A" });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockImplementation(() => searchParams);
    testDoubles.useRef.mockReturnValue(pageViewStateRef);
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    effectHarness.render(renderTracker);

    location.href = thirdUrl;
    searchParams = new URLSearchParams("q=c");
    effectHarness.render(renderTracker);
    titleObserver.queueTitle("Title B");
    titleObserver.flushQueuedTitles();

    location.href = fourthUrl;
    searchParams = new URLSearchParams("q=d");
    effectHarness.render(renderTracker);
    titleObserver.queueTitle("Title C");
    titleObserver.flushQueuedTitles();
    titleObserver.commitTitle("Title D");

    vi.advanceTimersByTime(250);

    expect(testDoubles.trackPageView.mock.calls).toEqual([
      [secondUrl, { referer: firstUrl, title: "Title B" }],
      [thirdUrl, { referer: secondUrl, title: "Title C" }],
      [fourthUrl, { referer: thirdUrl, title: "Title D" }],
    ]);

    vi.advanceTimersByTime(5_000);
    expect(testDoubles.trackPageView).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "coalesced B and C title writes",
      routes: [
        ["https://pets.example/codex-pets/?q=b", "Title B"],
        ["https://pets.example/codex-pets/?q=c", "Title C"],
      ],
    },
    {
      label: "an unchanged B title followed by C",
      routes: [
        ["https://pets.example/codex-pets/?q=b", "Title A"],
        ["https://pets.example/codex-pets/?q=c", "Title C"],
      ],
    },
    {
      label: "coalesced B, C, and D title writes",
      routes: [
        ["https://pets.example/codex-pets/?q=b", "Title B"],
        ["https://pets.example/codex-pets/?q=c", "Title C"],
        ["https://pets.example/codex-pets/?q=d", "Title D"],
      ],
    },
  ] as const)(
    "correlates $label with its exact URL",
    async ({ routes }) => {
      const firstUrl = "https://pets.example/codex-pets/?q=a";
      const location: { href: string; origin: string } = {
        href: routes[0][0],
        origin: "https://pets.example",
      };
      const titleObserver = installMutationObserverHarness();
      titleObserver.setPageViewMetadata(firstUrl, "Title A");
      const pageViewMetadataElement =
        titleObserver.getPageViewMetadataElement();
      const pageViewStateRef = {
        current: {
          title: "Title A",
          url: firstUrl,
        },
      };
      let searchParams = new URL(location.href).searchParams;
      const effectHarness = installEffectHarness();

      vi.useFakeTimers();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubGlobal("window", { location });
      vi.stubGlobal("document", {
        head: {},
        querySelector: (selector: string) =>
          selector === 'meta[name="codex-pets-page-view"]'
            ? pageViewMetadataElement
            : null,
        title: "Title A",
      });
      testDoubles.usePathname.mockReturnValue("/");
      testDoubles.useSearchParams.mockImplementation(() => searchParams);
      testDoubles.useRef.mockReturnValue(pageViewStateRef);
      vi.resetModules();

      const renderTracker = await loadRouteTrackerRender();
      effectHarness.render(renderTracker);

      for (const [url] of routes.slice(1)) {
        location.href = url;
        searchParams = new URL(url).searchParams;
        effectHarness.render(renderTracker);
      }

      for (const [url, title] of routes) {
        titleObserver.queuePageViewMetadata(url, title);
      }
      titleObserver.flushQueuedTitles();
      vi.advanceTimersByTime(5_000);

      expect(testDoubles.trackPageView.mock.calls).toEqual(
        routes.map(([url, title], index) => [
          url,
          {
            referer: index === 0 ? firstUrl : routes[index - 1][0],
            title,
          },
        ]),
      );
    },
  );

  it("retains a pending transition across same-URL dependency churn", async () => {
    const previousUrl = "https://pets.example/codex-pets/?q=previous";
    const destinationUrl = "https://pets.example/codex-pets/?q=red%20fox";
    const location = {
      href: destinationUrl,
      origin: "https://pets.example",
    };
    const titleObserver = installMutationObserverHarness();
    const pageViewStateRef = {
      current: {
        title: 'Codex pets matching "previous"',
        url: previousUrl,
      },
    };
    let searchParams = new URLSearchParams("q=red%20fox");
    const effectHarness = installEffectHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", {
      head: {},
      title: 'Codex pets matching "previous"',
    });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockImplementation(() => searchParams);
    testDoubles.useRef.mockReturnValue(pageViewStateRef);
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    effectHarness.render(renderTracker);

    searchParams = new URLSearchParams("q=red%20fox");
    effectHarness.render(renderTracker);
    titleObserver.commitTitle('Codex pets matching "red fox"');
    vi.advanceTimersByTime(250);

    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(destinationUrl, {
      referer: previousUrl,
      title: 'Codex pets matching "red fox"',
    });
  });

  it("cancels pending transitions when the route tracker unmounts", async () => {
    const previousUrl = "https://pets.example/codex-pets/?q=previous";
    const destinationUrl = "https://pets.example/codex-pets/?q=red%20fox";
    const location = {
      href: destinationUrl,
      origin: "https://pets.example",
    };
    const titleObserver = installMutationObserverHarness();
    const pageViewStateRef = {
      current: {
        title: 'Codex pets matching "previous"',
        url: previousUrl,
      },
    };
    const effectHarness = installEffectHarness();

    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", {
      head: {},
      title: 'Codex pets matching "previous"',
    });
    testDoubles.usePathname.mockReturnValue("/");
    testDoubles.useSearchParams.mockReturnValue(
      new URLSearchParams("q=red%20fox"),
    );
    testDoubles.useRef.mockReturnValue(pageViewStateRef);
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    effectHarness.render(renderTracker);
    effectHarness.unmount();

    titleObserver.commitTitle('Codex pets matching "red fox"');
    vi.advanceTimersByTime(10_000);

    expect(testDoubles.trackPageView).not.toHaveBeenCalled();
  });

  it("uses a bounded fallback when the destination title stays unchanged", async () => {
    const previousUrl = "https://pets.example/codex-pets/about";
    const destinationUrl = "https://pets.example/codex-pets/terms";
    const sharedTitle = "Codex Pets";

    vi.useFakeTimers();
    installMutationObserverHarness();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: destinationUrl,
        origin: "https://pets.example",
      },
    });
    vi.stubGlobal("document", { head: {}, title: sharedTitle });
    testDoubles.usePathname.mockReturnValue("/terms");
    testDoubles.useSearchParams.mockReturnValue(new URLSearchParams());
    testDoubles.useRef.mockReturnValue({
      current: {
        title: sharedTitle,
        url: previousUrl,
      },
    });
    testDoubles.useEffect.mockImplementation((effect) => effect());
    vi.resetModules();

    const renderTracker = await loadRouteTrackerRender();
    renderTracker();

    expect(testDoubles.trackPageView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);

    expect(testDoubles.trackPageView).toHaveBeenCalledOnce();
    expect(testDoubles.trackPageView).toHaveBeenCalledWith(destinationUrl, {
      referer: previousUrl,
      title: sharedTitle,
    });
  });
});
