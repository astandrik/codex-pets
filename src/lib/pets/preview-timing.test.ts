import {describe, expect, it} from "vitest";
import {PET_STATES} from "./types";
import {previewCycleDurationMs, previewFrameDurationMs, previewFrameDurationsMs, previewFrameStops} from "./preview-timing";

// Golden timing observed in the installed Codex desktop 26.1027.30824.
const native = {
  idle: [1680, 660, 660, 840, 840, 1920],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280],
};

describe("Codex preview timing", () => {
  it.each(PET_STATES)("preserves $key frame holds and loop seam", state => {
    const expected = native[state.key];
    expect(previewFrameDurationsMs(state.key)).toEqual(expected);
    expect(expected).toHaveLength(state.frames);
    const total = expected.reduce((sum, duration) => sum + duration, 0);
    expect(previewCycleDurationMs(state.key)).toBe(total);
    let elapsed = 0;
    previewFrameStops(state.key).forEach(({frame, percent}, index) => {
      expect(frame).toBe(index);
      expect(percent * total / 100).toBeCloseTo(elapsed, 8);
      expect(previewFrameDurationMs(state.key, index)).toBe(expected[index]);
      elapsed += expected[index];
    });
    expect(previewFrameDurationMs(state.key, state.frames)).toBe(expected[0]);
  });
  it("keeps the site-only gaze slideshow independent from sprite animation timing", () => {
    expect(previewFrameDurationsMs("look-directions")).toEqual(Array(16).fill(350));
  });
});
