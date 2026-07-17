import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  YANDEX_METRIKA_ID,
  getYandexMetrikaInlineScript,
  trackPageView,
} from "@/lib/metrics/yandex";

function runInlineScript() {
  const insertBefore = vi.fn();
  const context: Record<string, unknown> = {
    document: {
      createElement: () => ({}),
      getElementsByTagName: () => [
        {
          parentNode: { insertBefore },
        },
      ],
      referrer: "https://referrer.example/source",
      scripts: [],
      title: "Codex Pets",
    },
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
    calls: ym.a.map((args) => Array.from(args)),
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
