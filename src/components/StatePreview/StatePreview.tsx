"use client";

import { useEffect, useMemo, useState } from "react";

import { parseClientPetJson } from "@/lib/pets/client-validation";
import {
  getLookDirectionCell,
  getPetSheet,
  inferSpriteVersionNumber,
  PET_LOOK_DIRECTIONS,
  PET_STATES,
  type SpriteVersionNumber,
} from "@/lib/pets/types";
import "./StatePreview.scss";

type StatePreviewProps = {
  petJsonUrl: string;
  spritesheetUrl: string;
};

type PetStateKey = (typeof PET_STATES)[number]["key"];
type PreviewKey = PetStateKey | "look-directions";

export function StatePreview({ petJsonUrl, spritesheetUrl }: StatePreviewProps) {
  const [selectedKey, setSelectedKey] = useState<PreviewKey>(
    PET_STATES[0].key,
  );
  const [frame, setFrame] = useState(0);
  const [lookPlaying, setLookPlaying] = useState(true);
  const [declaredVersion, setDeclaredVersion] =
    useState<SpriteVersionNumber | null>(null);
  const [imageVersion, setImageVersion] =
    useState<SpriteVersionNumber | null>(null);
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
    let active = true;
    fetch(petJsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load pet.json.");
        return response.text();
      })
      .then((text) => parseClientPetJson(text))
      .then((petJson) => {
        if (active) setDeclaredVersion(petJson.spriteVersionNumber ?? 1);
      })
      .catch(() => {
        if (active) setDeclaredVersion(null);
      });
    return () => {
      active = false;
    };
  }, [petJsonUrl]);

  useEffect(() => {
    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (active) {
        setImageVersion(
          inferSpriteVersionNumber(image.naturalWidth, image.naturalHeight),
        );
      }
    };
    image.onerror = () => {
      if (active) setImageVersion(null);
    };
    image.src = spritesheetUrl;
    return () => {
      active = false;
    };
  }, [spritesheetUrl]);

  useEffect(() => {
    if (isLookDirections && !lookPlaying) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % frameCount);
    }, 140);
    return () => window.clearInterval(timer);
  }, [frameCount, isLookDirections, lookPlaying]);

  const x = column === 0 ? 0 : (column / (sheet.columns - 1)) * 100;
  const y = row === 0 ? 0 : (row / (sheet.rows - 1)) * 100;
  const previewLabel = lookDirection
    ? `Look ${lookDirection.degrees} degrees ${lookDirection.label}`
    : selected.label;

  return (
    <section className="state-preview panel">
      <div className="state-preview__stage">
        <div
          className="state-preview__sprite"
          aria-label={`${previewLabel} preview`}
          style={{
            backgroundImage: `url(${spritesheetUrl})`,
            backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
            backgroundPosition: `${x}% ${y}%`,
          }}
        />
        {lookDirection ? (
          <div className="state-preview__direction-label">
            <strong>{lookDirection.displayDegrees}</strong>
            <span>{lookDirection.label}</span>
            {!lookPlaying ? <small>Paused</small> : null}
          </div>
        ) : null}
      </div>
      <div className="state-preview__controls">
        {PET_STATES.map((state) => (
          <button
            key={state.key}
            type="button"
            className={
              state.key === selected.key
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
      </div>
      {isLookDirections ? (
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
              title={direction.label}
              onClick={() => {
                setFrame(direction.index);
                setLookPlaying(false);
              }}
            >
              {direction.displayDegrees}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
