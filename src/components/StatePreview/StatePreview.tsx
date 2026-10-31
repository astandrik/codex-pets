"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, Dialog } from "@gravity-ui/uikit";

import { parseClientPetJson } from "@/lib/pets/client-validation";
import { previewFrameDurationMs } from "@/lib/pets/preview-timing";
import {
  getLookDirectionCell,
  getPetSheet,
  inferSpriteVersionNumber,
  PET_LOOK_DIRECTIONS,
  PET_STATES,
  type SpriteVersionNumber,
} from "@/lib/pets/types";
import { AnimationOverview } from "./AnimationOverview";
import "./StatePreview.scss";

type StatePreviewProps = {
  petJsonUrl: string;
  spritesheetUrl: string;
  selectedKey?: PreviewKey;
  frame?: number;
  hideControls?: boolean;
  layout?: "default" | "generation";
  active?: boolean;
  playbackSuspended?: boolean;
  slots?: { afterStage?: ReactNode; sidePanel?: ReactNode; afterControls?: ReactNode };
};

type PetStateKey = (typeof PET_STATES)[number]["key"];
type PreviewKey = PetStateKey | "look-directions";

export function StatePreview({ petJsonUrl, spritesheetUrl, selectedKey: controlledKey, frame: controlledFrame, hideControls = false, layout = "default", active = true, playbackSuspended = false, slots }: StatePreviewProps) {
  const [localKey, setSelectedKey] = useState<PreviewKey>(
    PET_STATES[0].key,
  );
  const [localFrame, setFrame] = useState(0);
  const [lookPlaying, setLookPlaying] = useState(true);
  const [declaredVersion, setDeclaredVersion] =
    useState<SpriteVersionNumber | null>(null);
  const [imageVersion, setImageVersion] =
    useState<SpriteVersionNumber | null>(null);
  const [gazeOpen, setGazeOpen] = useState(false);
  const overview = layout === "generation" && !hideControls && controlledKey === undefined && controlledFrame === undefined;
  const selectedKey = controlledKey ?? localKey;
  const frame = controlledFrame ?? localFrame;
  const selected = useMemo(
    () =>
      PET_STATES.find((state) => state.key === selectedKey) ?? PET_STATES[0],
    [selectedKey],
  );
  const spriteVersionNumber =
    imageVersion !== null &&
    (declaredVersion === null || declaredVersion === imageVersion)
      ? imageVersion
      : 1;
  const sheet = getPetSheet(spriteVersionNumber);
  const isLookDirections =
    spriteVersionNumber === 2 && selectedKey === "look-directions";
  const frameCount = isLookDirections ? 16 : selected.frames;
  const lookDirection = isLookDirections
    ? getLookDirectionCell(frame)
    : null;
  const row = lookDirection?.row ?? selected.row;
  const column = lookDirection?.column ?? frame;

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    fetch(petJsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load pet.json.");
        return response.text();
      })
      .then((text) => parseClientPetJson(text))
      .then((petJson) => {
        if (mounted) setDeclaredVersion(petJson.spriteVersionNumber ?? 1);
      })
      .catch(() => {
        if (mounted) setDeclaredVersion(null);
      });
    return () => {
      mounted = false;
    };
  }, [petJsonUrl, active]);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const image = new window.Image();
    image.onload = () => {
      if (mounted) {
        setImageVersion(
          inferSpriteVersionNumber(image.naturalWidth, image.naturalHeight),
        );
      }
    };
    image.onerror = () => {
      if (mounted) setImageVersion(null);
    };
    image.src = spritesheetUrl;
    return () => {
      mounted = false;
    };
  }, [spritesheetUrl, active]);

  useEffect(() => {
    if (!active || controlledFrame !== undefined || (isLookDirections && !lookPlaying)) return;
    if (overview && (!gazeOpen || !isLookDirections || playbackSuspended)) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (overview && document.hidden) { schedule(); return; }
        setFrame((current) => (current + 1) % frameCount);
      }, previewFrameDurationMs(selectedKey, frame));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [frameCount, selectedKey, frame, isLookDirections, lookPlaying, controlledFrame, active, overview, gazeOpen, playbackSuspended]);

  const x = column === 0 ? 0 : (column / (sheet.columns - 1)) * 100;
  const y = row === 0 ? 0 : (row / (sheet.rows - 1)) * 100;
  const previewLabel = lookDirection
    ? `Look ${lookDirection.degrees} degrees ${lookDirection.label}`
    : selected.label;

  const spriteStyle = {
    backgroundImage: `url(${spritesheetUrl})`,
    backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
  const directions = !hideControls && isLookDirections ? (
        <div className="state-preview__directions" aria-label="Look directions">
          {PET_LOOK_DIRECTIONS.map((direction) => (
            <button
              key={direction.index}
              type="button"
              className={
                direction.index === frame
                  ? "state-preview__direction state-preview__direction--active"
                  : "state-preview__direction"
              }
              aria-pressed={direction.index === frame}
              aria-label={direction.accessibleLabel}
              title={direction.accessibleLabel}
              onClick={() => {
                setFrame(direction.index);
                setLookPlaying(false);
              }}
            >
              {direction.displayDegrees}
            </button>
          ))}
        </div>
      ) : null;

  if (layout === "generation") {
    return <section className={active ? `state-preview state-preview--generation${overview ? " state-preview--overview" : ""}` : undefined}>
      {active && <div className="state-preview__stage">
        {overview ? <AnimationOverview spritesheetUrl={spritesheetUrl} sheet={sheet} suspended={playbackSuspended || gazeOpen}/> : <>
        <div className="state-preview__sprite" aria-label={`${previewLabel} preview`} style={spriteStyle} />
        <p className="state-preview__caption">{isLookDirections ? `${lookDirection?.displayDegrees} · ${lookDirection?.label}${lookPlaying ? "" : " · Paused"}` : `${selected.label} · ${selected.frames} frames`}</p>
        </>}
      </div>}
      {active && slots?.afterStage && <div className="state-preview__downloads">{slots.afterStage}</div>}
      {active && !hideControls && <div className="state-preview__generation-controls">
        {!overview && <>
        <label className="state-preview__chooser">Animation
          <select aria-label="Animation" value={isLookDirections ? "" : selectedKey} onChange={event => {
            const state = PET_STATES.find(item => item.key === event.target.value);
            if (state) { setSelectedKey(state.key); setFrame(0); setLookPlaying(true); }
          }}>
            {isLookDirections && <option value="" disabled>Look directions</option>}
            {PET_STATES.map(state => <option key={state.key} value={state.key}>{state.label} · {state.frames} frames</option>)}
          </select>
        </label>
        <div className="state-preview__controls">
          {PET_STATES.map(state => <button key={state.key} type="button" aria-pressed={state.key === selectedKey}
            className={`state-preview__button${state.key === selectedKey ? " state-preview__button--active" : ""}`}
            onClick={() => { setSelectedKey(state.key); setFrame(0); setLookPlaying(true); }}>
            {state.label} · {state.frames} frames
          </button>)}
        </div>
        </>}
        {spriteVersionNumber === 2 && <>
          <button type="button" className="state-preview__gaze-trigger" onClick={() => {
            if (!isLookDirections) { setSelectedKey("look-directions"); setFrame(0); setLookPlaying(true); }
            setGazeOpen(true);
          }}><span>Look directions<small>16 directions · choose an angle to pause</small></span><span aria-hidden="true">›</span></button>
          <Dialog open={gazeOpen} onClose={() => setGazeOpen(false)} returnFocus contentOverflow="auto" size="m" className="state-preview__gaze-dialog" aria-label="Look directions">
            <Dialog.Header caption="Look directions" />
            <Dialog.Body>
              <div className="state-preview__gaze-sprite" style={spriteStyle} aria-label={`${previewLabel} preview`} />
              <p>{lookDirection?.displayDegrees} · {lookDirection?.label} · {lookPlaying ? "Playing" : "Paused"}</p>
              {directions}
              <Button type="button" onClick={() => setLookPlaying(true)}>Resume</Button>
            </Dialog.Body>
            <Dialog.Footer><Button type="button" aria-label="Close gaze panel" onClick={() => setGazeOpen(false)}>Close</Button></Dialog.Footer>
          </Dialog>
        </>}
      </div>}
      {slots?.sidePanel && <div className="state-preview__actions">{slots.sidePanel}</div>}
      {active && slots?.afterControls && <div className="state-preview__details">{slots.afterControls}</div>}
    </section>;
  }

  return (
    <section className="state-preview panel">
      <div className="state-preview__stage">
        <div
          className="state-preview__sprite"
          aria-label={`${previewLabel} preview`}
          style={spriteStyle}
        />
        {lookDirection ? (
          <div className="state-preview__direction-label">
            <strong>{lookDirection.displayDegrees}</strong>
            <span>{lookDirection.label}</span>
            {!lookPlaying ? <small>Paused</small> : null}
          </div>
        ) : null}
      </div>
      {!hideControls && <div className="state-preview__controls">
        {PET_STATES.map((state) => (
          <button
            key={state.key}
            type="button"
            className={
              state.key === selectedKey
                ? "state-preview__button state-preview__button--active"
                : "state-preview__button"
            }
            onClick={() => {
              setSelectedKey(state.key);
              setFrame(0);
              setLookPlaying(true);
            }}
          >
            <span>{state.label}</span>
            <small>{state.frames} frames</small>
          </button>
        ))}
        {spriteVersionNumber === 2 ? (
          <button
            type="button"
            className={
              isLookDirections
                ? "state-preview__button state-preview__button--active"
                : "state-preview__button"
            }
            onClick={() => {
              const wasLookDirections = selectedKey === "look-directions";
              setSelectedKey("look-directions");
              if (!wasLookDirections) setFrame(0);
              setLookPlaying(true);
            }}
          >
            <span>Look directions</span>
            <small>16 frames</small>
          </button>
        ) : null}
      </div>}
      {directions}
    </section>
  );
}
