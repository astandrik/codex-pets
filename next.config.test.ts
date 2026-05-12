import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next config", () => {
  it("blocks streamed metadata for preview crawlers without matching browsers", () => {
    const htmlLimitedBots = nextConfig.htmlLimitedBots;

    expect(htmlLimitedBots).toBeInstanceOf(RegExp);
    expect(htmlLimitedBots?.test("TelegramBot")).toBe(true);
    expect(htmlLimitedBots?.test("WebpageBot")).toBe(true);
    expect(htmlLimitedBots?.test("Bingbot")).toBe(true);
    expect(
      htmlLimitedBots?.test(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ),
    ).toBe(false);
  });
});
