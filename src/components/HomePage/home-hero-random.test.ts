import { describe, expect, it } from "vitest";

import { pickRandomHeroPetIndex } from "@/components/HomePage/home-hero-random";

describe("pickRandomHeroPetIndex", () => {
  it("returns null when there are no pets", () => {
    expect(pickRandomHeroPetIndex(0)).toBeNull();
    expect(pickRandomHeroPetIndex(-1)).toBeNull();
  });

  it("returns the only available index for one pet", () => {
    expect(pickRandomHeroPetIndex(1, null, () => 0.99)).toBe(0);
    expect(pickRandomHeroPetIndex(1, 0, () => 0.5)).toBe(0);
  });

  it("uses random selection when there is no current pet", () => {
    expect(pickRandomHeroPetIndex(4, null, () => 0)).toBe(0);
    expect(pickRandomHeroPetIndex(4, null, () => 0.74)).toBe(2);
    expect(pickRandomHeroPetIndex(4, null, () => 1)).toBe(3);
  });

  it("avoids returning the current index when multiple pets exist", () => {
    for (const value of [0, 0.1, 0.5, 0.99, 1]) {
      const next = pickRandomHeroPetIndex(5, 2, () => value);

      expect(next).not.toBe(2);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(5);
    }
  });
});
