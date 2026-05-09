"use client";

import { useEffect, useMemo, useState } from "react";

import { PET_SHEET, PET_STATES } from "@/lib/pets/types";
import "./StatePreview.scss";

type StatePreviewProps = {
  spritesheetUrl: string;
};

type PetStateKey = (typeof PET_STATES)[number]["key"];

export function StatePreview({ spritesheetUrl }: StatePreviewProps) {
  const [selectedKey, setSelectedKey] = useState<PetStateKey>(
    PET_STATES[0].key,
  );
  const [frame, setFrame] = useState(0);
  const selected = useMemo(
    () => PET_STATES.find((state) => state.key === selectedKey) ?? PET_STATES[0],
    [selectedKey],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % selected.frames);
    }, 140);
    return () => window.clearInterval(timer);
  }, [selected.frames]);

  const x = frame === 0 ? 0 : (frame / (PET_SHEET.columns - 1)) * 100;
  const y = selected.row === 0 ? 0 : (selected.row / (PET_SHEET.rows - 1)) * 100;

  return (
    <section className="state-preview panel">
      <div className="state-preview__stage">
        <div
          className="state-preview__sprite"
          aria-label={`${selected.label} preview`}
          style={{
            backgroundImage: `url(${spritesheetUrl})`,
            backgroundSize: `${PET_SHEET.columns * 100}% ${PET_SHEET.rows * 100}%`,
            backgroundPosition: `${x}% ${y}%`,
          }}
        />
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
            }}
          >
            <span>{state.label}</span>
            <small>{state.frames} frames</small>
          </button>
        ))}
      </div>
    </section>
  );
}
