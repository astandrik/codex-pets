import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getYandexMetrikaInlineScript, trackPageView, trackGoal, setGenerationAnalyticsPrivacy } from "@/lib/metrics/yandex";

afterEach(() => { vi.unstubAllGlobals(); });
describe("unlisted generation analytics", () => {
  it("does not initialize or download analytics on a direct private preview visit", () => {
    const context = { location: new URL("https://pets.example/generated/" + "a".repeat(64)), document: {}, window: {} };
    context.window = context;
    expect(() => runInNewContext(getYandexMetrikaInlineScript(), context)).not.toThrow();
    expect(context).not.toHaveProperty("ym");
  });
  it("suppresses hits and goals on private pages and scrubs private referrers", () => {
    const ym = vi.fn(); const location = new URL("https://pets.example/generated/" + "a".repeat(64));
    vi.stubGlobal("window", { ym, location });
    trackGoal("download"); trackPageView(location.href, {});
    expect(ym).not.toHaveBeenCalled();
    vi.stubGlobal("window", { ym, location: new URL("https://pets.example/") });
    trackPageView("https://pets.example/", { referer: location.href, title: "Pets" });
    expect(ym.mock.calls[0]?.[3]).toEqual({ referer: "", title: "Pets" });
  });
  it("stops an existing SPA counter during preview and restarts only on a public page", () => {
    const ym = vi.fn(); vi.stubGlobal("window", { ym, location: new URL("https://pets.example/") });
    vi.stubGlobal("document", { title: "Pets" });
    setGenerationAnalyticsPrivacy(true);
    expect(ym.mock.calls[0]?.[1]).toBe("destruct");
    setGenerationAnalyticsPrivacy(false);
    expect(ym.mock.calls.map((x) => x[1])).toEqual(["destruct", "init", "hit"]);
  });
});

it("never initializes analytics or webvisor on the prompt entry form", () => {
  const context = { location: new URL("https://pets.example/generate"), document: {}, window: {} };
  context.window = context;
  expect(() => runInNewContext(getYandexMetrikaInlineScript(), context)).not.toThrow();
  expect(context).not.toHaveProperty("ym");
});


it("never starts analytics on the admin IP quota form, including goals and referrers", () => {
  const location = new URL("https://pets.example/admin/generation-limits");
  const context = { location, document: {}, window: {} };context.window=context;
  expect(()=>runInNewContext(getYandexMetrikaInlineScript(),context)).not.toThrow();expect(context).not.toHaveProperty("ym");
  const ym=vi.fn();vi.stubGlobal("window",{ym,location});trackGoal("grant");trackPageView(location.href,{});expect(ym).not.toHaveBeenCalled();
  vi.stubGlobal("window",{ym,location:new URL("https://pets.example/")});trackPageView("https://pets.example/",{referer:location.href});
  expect(ym.mock.calls[0]?.[3].referer).toBe("");
});

it("keeps browser generation history out of analytics, goals and referrers", () => {
  const location=new URL("https://pets.example/my-generations");
  const context={location,document:{},window:{}};context.window=context;
  expect(()=>runInNewContext(getYandexMetrikaInlineScript(),context)).not.toThrow();expect(context).not.toHaveProperty("ym");
  const ym=vi.fn();vi.stubGlobal("window",{ym,location});trackGoal("open_generation");trackPageView(location.href,{});expect(ym).not.toHaveBeenCalled();
  vi.stubGlobal("window",{ym,location:new URL("https://pets.example/")});trackPageView("https://pets.example/",{referer:location.href});expect(ym.mock.calls[0]?.[3].referer).toBe("");
});
