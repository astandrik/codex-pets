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

  it("avoids recently shown indexes when alternatives exist", () => {
    expect(
      pickRandomHeroPetIndex(6, 2, {
        excludedIndexes: [0, 1, 3],
        random: () => 0,
      }),
    ).toBe(4);
    expect(
      pickRandomHeroPetIndex(6, 2, {
        excludedIndexes: [0, 1, 3],
        random: () => 0.99,
      }),
    ).toBe(5);
  });

  it("falls back to avoiding only the current index when exclusions cover every alternative", () => {
    const next = pickRandomHeroPetIndex(3, 1, {
      excludedIndexes: [0, 2],
      random: () => 0.99,
    });

    expect(next).toBe(2);
    expect(next).not.toBe(1);
  });

  it("ignores invalid excluded indexes", () => {
    expect(
      pickRandomHeroPetIndex(4, 0, {
        excludedIndexes: [-1, 0.5, 4, 99],
        random: () => 0,
      }),
    ).toBe(1);
  });
});
