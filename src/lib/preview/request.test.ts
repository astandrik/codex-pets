import { describe, expect, it } from "vitest";

import {
  getPreviewRewritePath,
  isLikelyPreviewRequest,
  withRequestBasePath,
} from "@/lib/preview/request";

describe("preview request routing", () => {
  it("rewrites TelegramBot pet requests to the preview route", () => {
    const rewritePath = getPreviewRewritePath({
      method: "GET",
      pathname: "/codex-pets/pets/tigran",
      basePath: "/codex-pets",
      headers: new Headers({
        "user-agent": "TelegramBot",
      }),
    });

    expect(rewritePath).toBe("/api/preview/pets/tigran");
  });

  it("rewrites known Telegram edge IP requests even with browser-like UAs", () => {
    const rewritePath = getPreviewRewritePath({
      method: "GET",
      pathname: "/codex-pets/pets/jinx",
      basePath: "/codex-pets",
      headers: new Headers({
        "user-agent":
          "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:77.0) Gecko/20190101 Firefox/77.0",
        "x-forwarded-for": "95.161.76.8, 127.0.0.1",
      }),
    });

    expect(rewritePath).toBe("/api/preview/pets/jinx");
  });

  it("does not rewrite normal browser traffic", () => {
    const rewritePath = getPreviewRewritePath({
      method: "GET",
      pathname: "/codex-pets/pets/tigran",
      basePath: "/codex-pets",
      headers: new Headers({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "x-forwarded-for": "203.0.113.10",
      }),
    });

    expect(rewritePath).toBeNull();
    expect(
      isLikelyPreviewRequest(
        new Headers({
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "x-forwarded-for": "203.0.113.10",
        }),
      ),
    ).toBe(false);
  });

  it("restores the configured base path for internal rewrites", () => {
    expect(withRequestBasePath("/api/preview/site", "/codex-pets")).toBe(
      "/codex-pets/api/preview/site",
    );
  });
});
