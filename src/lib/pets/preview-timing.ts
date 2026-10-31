import {PET_STATES} from "@/lib/pets/types";

type PetStateKey = (typeof PET_STATES)[number]["key"];
type PreviewKey = PetStateKey | "look-directions";

function frameDurations(count: number, normal: number, last: number): readonly number[] {
  return Array.from({length: count}, (_, index) => index === count - 1 ? last : normal);
}

// Codex desktop 26.1027.30824 holds idle frames 6x longer and pauses on action endings.
const FRAME_DURATIONS_MS: Record<PetStateKey, readonly number[]> = {
  idle: [1680, 660, 660, 840, 840, 1920],
  "running-right": frameDurations(8, 120, 220),
  "running-left": frameDurations(8, 120, 220),
  waving: frameDurations(4, 140, 280),
  jumping: frameDurations(5, 140, 280),
  failed: frameDurations(8, 140, 240),
  waiting: frameDurations(6, 150, 260),
  running: frameDurations(6, 120, 220),
  review: frameDurations(6, 150, 280),
};

// Codex follows the pointer for gaze; the site's optional direction slideshow has no native cadence.
const LOOK_DIRECTION_DURATIONS_MS = Array<number>(16).fill(350);

export function previewFrameDurationsMs(state: PreviewKey): readonly number[] {
  return state === "look-directions" ? LOOK_DIRECTION_DURATIONS_MS : FRAME_DURATIONS_MS[state];
}

export function previewFrameDurationMs(state: PreviewKey, frame: number): number {
  const durations = previewFrameDurationsMs(state);
  return durations[frame % durations.length];
}

export function previewCycleDurationMs(state: PetStateKey): number {
  return FRAME_DURATIONS_MS[state].reduce((total, duration) => total + duration, 0);
}

export function previewFrameStops(state: PetStateKey): {frame: number; percent: number}[] {
  const total = previewCycleDurationMs(state);
  let elapsed = 0;
  return FRAME_DURATIONS_MS[state].map((duration, frame) => {
    const stop = {frame, percent: elapsed / total * 100};
    elapsed += duration;
    return stop;
  });
}
