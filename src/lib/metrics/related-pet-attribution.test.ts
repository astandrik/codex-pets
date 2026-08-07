// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRelatedPetGoalParams,
  readRelatedPetAttribution,
  RELATED_PET_ATTRIBUTION_STORAGE_KEY,
  RELATED_PET_ATTRIBUTION_TTL_MS,
  storeRelatedPetAttribution,
} from "@/lib/metrics/related-pet-attribution";

const context = {
  sourceSlug: "orbit-otter",
  targetSlug: "star-fox",
  position: 8,
};

describe("related pet attribution", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores a valid context and exposes goal params", () => {
    storeRelatedPetAttribution(context, 1_000);

    expect(readRelatedPetAttribution("star-fox", 1_001)).toEqual(context);
    expect(getRelatedPetGoalParams(context)).toEqual({
      source_slug: "orbit-otter",
      target_slug: "star-fox",
      position: 8,
      origin: "related_pet",
    });
  });

  it("reads attribution only for the matching target within 30 minutes", () => {
    storeRelatedPetAttribution(context, 1_000);

    expect(readRelatedPetAttribution("terminal-cube", 1_001)).toBeNull();
    expect(
      readRelatedPetAttribution(
        "star-fox",
        1_000 + RELATED_PET_ATTRIBUTION_TTL_MS,
      ),
    ).toEqual(context);
    expect(
      readRelatedPetAttribution(
        "star-fox",
        1_001 + RELATED_PET_ATTRIBUTION_TTL_MS,
      ),
    ).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify({ ...context, position: 9, clickedAt: 1_000 }),
    JSON.stringify({ ...context, targetSlug: "../admin", clickedAt: 1_000 }),
    JSON.stringify({ ...context, clickedAt: 1_001 }),
  ])("rejects and clears invalid storage: %s", (stored) => {
    window.sessionStorage.setItem(RELATED_PET_ATTRIBUTION_STORAGE_KEY, stored);

    expect(readRelatedPetAttribution("star-fox", 1_000)).toBeNull();
    expect(
      window.sessionStorage.getItem(RELATED_PET_ATTRIBUTION_STORAGE_KEY),
    ).toBeNull();
  });

  it("fails closed when sessionStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => storeRelatedPetAttribution(context, 1_000)).not.toThrow();
    expect(readRelatedPetAttribution("star-fox", 1_001)).toBeNull();
  });
});
