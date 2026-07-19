import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  YANDEX_METRIKA_ID,
  getYandexMetrikaInlineScript,
  trackPageView,
} from "@/lib/metrics/yandex";

type InlineScriptOptions = {
  readyState?: DocumentReadyState;
  title?: string;
};

function runInlineScript({
  readyState = "complete",
  title = "Codex Pets",
}: InlineScriptOptions = {}) {
  const insertBefore = vi.fn();
  let domContentLoadedListener: (() => void) | undefined;
  const addEventListener = vi.fn(
    (eventName: string, listener: () => void) => {
      if (eventName === "DOMContentLoaded") {
        domContentLoadedListener = listener;
      }
    },
  );
  const document = {
    addEventListener,
    createElement: () => ({}),
    getElementsByTagName: () => [
      {
        parentNode: { insertBefore },
      },
    ],
    readyState,
    referrer: "https://referrer.example/source",
    scripts: [],
    title,
  };
  const context: Record<string, unknown> = {
    document,
    location: {
      href: "https://pets.example/gallery?tag=otter",
    },
  };
  context.window = context;

  runInNewContext(getYandexMetrikaInlineScript(), context);

  const ym = context.ym as {
    a: ArrayLike<unknown>[];
  };

  return {
    addEventListener,
    get calls() {
      return ym.a.map((args) => Array.from(args));
    },
    dispatchDOMContentLoaded(nextTitle: string) {
      document.title = nextTitle;
      const listener = domContentLoadedListener;
      domContentLoadedListener = undefined;
      listener?.();
    },
    insertBefore,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Yandex Metrika inline initialization", () => {
  it("defers the automatic initial pageview", () => {
    const { calls } = runInlineScript();
    const initCall = calls.find((call) => call[1] === "init");

    expect(initCall?.[2]).toMatchObject({ defer: true });
  });

  it("queues exactly one initial hit with browser page context", () => {
    const { calls } = runInlineScript();
    const hitCalls = calls.filter((call) => call[1] === "hit");

    expect(hitCalls).toEqual([
      [
        YANDEX_METRIKA_ID,
        "hit",
        "https://pets.example/gallery?tag=otter",
        {
          referer: "https://referrer.example/source",
          title: "Codex Pets",
        },
      ],
    ]);
  });

  it("waits for streamed metadata before queuing the initial hit", () => {
    const execution = runInlineScript({
      readyState: "loading",
      title: "Codex Pets",
    });

    expect(execution.calls.filter((call) => call[1] === "hit")).toEqual([]);
    expect(execution.addEventListener).toHaveBeenCalledWith(
      "DOMContentLoaded",
      expect.any(Function),
      { once: true },
    );

    execution.dispatchDOMContentLoaded("Rose Katana - Codex Pets");

    expect(execution.calls.filter((call) => call[1] === "hit")).toEqual([
      [
        YANDEX_METRIKA_ID,
        "hit",
        "https://pets.example/gallery?tag=otter",
        {
          referer: "https://referrer.example/source",
          title: "Rose Katana - Codex Pets",
        },
      ],
    ]);

    execution.dispatchDOMContentLoaded("Another title");
    expect(execution.calls.filter((call) => call[1] === "hit")).toHaveLength(1);
  });
});

describe("trackPageView", () => {
  it("dispatches a hit with the supplied page context", () => {
    const ym = vi.fn();
    vi.stubGlobal("window", { ym });

    trackPageView("https://pets.example/pets/orbit-otter", {
      referer: "https://pets.example/gallery?tag=otter",
      title: "Orbit Otter",
    });

    expect(ym).toHaveBeenCalledOnce();
    expect(ym).toHaveBeenCalledWith(
      YANDEX_METRIKA_ID,
      "hit",
      "https://pets.example/pets/orbit-otter",
      {
        referer: "https://pets.example/gallery?tag=otter",
        title: "Orbit Otter",
      },
    );
  });

  it("does nothing when the browser counter is unavailable", () => {
    vi.stubGlobal("window", {});

    expect(() =>
      trackPageView("https://pets.example/gallery", {}),
    ).not.toThrow();
  });

  it("swallows counter failures", () => {
    vi.stubGlobal("window", {
      ym: () => {
        throw new Error("metrics unavailable");
      },
    });

    expect(() =>
      trackPageView("https://pets.example/gallery", {}),
    ).not.toThrow();
  });
});
