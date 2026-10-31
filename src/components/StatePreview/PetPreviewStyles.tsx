import {previewFrameStops} from "@/lib/pets/preview-timing";
import {PET_STATES} from "@/lib/pets/types";

const idleKeyframes = previewFrameStops("idle").map(({frame, percent}) =>
  `${percent}%{transform:translate3d(${-frame / PET_STATES[0].frames * 100}%,0,0)}`,
).join("");

export function PetPreviewStyles() {
  return <style id="pet-preview-keyframes">{`@keyframes pet-idle-preview{${idleKeyframes}100%{transform:translate3d(0,0,0)}}`}</style>;
}
