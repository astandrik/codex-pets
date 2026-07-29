import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { SITE_NAME } from "@/lib/site-metadata";

describe("web manifest", () => {
  it("exposes site identity, start url, and brand icons", () => {
    const data = manifest();

    expect(data.name).toContain(SITE_NAME);
    expect(data.start_url).toBe("/");
    expect(data.display).toBe("standalone");

    const icons = (data.icons ?? []).map((icon) => `${icon.sizes}:${icon.src}`);
    expect(icons).toContain("any:/favicon.svg");
    expect(icons).toContain("192x192:/assets/brand-icon-192.png");
    expect(icons).toContain("512x512:/assets/brand-icon-512.png");
  });
});
