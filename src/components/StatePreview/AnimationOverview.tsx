"use client";

import {useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties} from "react";
import {Dialog} from "@gravity-ui/uikit";
import {PET_STATES, type PetSheet} from "@/lib/pets/types";
import "./AnimationOverview.scss";

type Props = {spritesheetUrl: string; sheet: PetSheet; suspended: boolean};
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const prefersReducedMotion = () => window.matchMedia(motionQuery).matches;
const isVisible = () => !document.hidden;
const serverReducedMotion = () => true;
const serverVisible = () => false;

export function AnimationOverview({spritesheetUrl, sheet, suspended}: Props) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, prefersReducedMotion, serverReducedMotion);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, serverVisible);
  const [playPreference, setPlayPreference] = useState<boolean | null>(null);
  const [frames, setFrames] = useState(() => PET_STATES.map(() => 0));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailFrame, setDetailFrame] = useState(0);
  const [detailPlaying, setDetailPlaying] = useState(false);
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const gridPlaying = playPreference ?? !reducedMotion;
  const selected = PET_STATES[selectedIndex];
  const running = visible && !suspended && (detailOpen ? detailPlaying : gridPlaying);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (detailOpen) setDetailFrame(frame => (frame + 1) % selected.frames);
      else setFrames(current => current.map((frame, index) => (frame + 1) % PET_STATES[index].frames));
    }, 140);
    return () => window.clearInterval(timer);
  }, [running, detailOpen, selected.frames]);

  const changeAnimation = useCallback((direction: number) => {
    const next = (selectedIndex + direction + PET_STATES.length) % PET_STATES.length;
    setSelectedIndex(next);
    setDetailFrame(0);
    returnFocus.current = cards.current[next];
  }, [selectedIndex]);

  useEffect(() => {
    if (!detailOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      changeAnimation(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, changeAnimation]);

  function spriteStyle(row: number, frame: number): CSSProperties {
    return {
      backgroundImage: `url(${spritesheetUrl})`,
      backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
      backgroundPosition: `${frame / (sheet.columns - 1) * 100}% ${row / (sheet.rows - 1) * 100}%`,
      aspectRatio: `${sheet.cellWidth} / ${sheet.cellHeight}`,
    };
  }

  return <>
    <section className="animation-overview" aria-label="All animations">
      <div className="animation-overview__bar">
        <h2>All animations</h2>
        <button type="button" className="animation-overview__control" aria-label={gridPlaying ? "Pause all animations" : "Play all animations"} onClick={() => setPlayPreference(!gridPlaying)}>{gridPlaying ? "Pause all" : "Play all"}</button>
      </div>
      <div className="animation-overview__grid">
        {PET_STATES.map((state, index) => <button key={state.key} ref={node => {cards.current[index] = node;}} type="button" className="animation-overview__card" aria-label={`Open ${state.label} animation`} aria-haspopup="dialog" aria-current={index === selectedIndex ? "true" : undefined} onClick={() => {
          setSelectedIndex(index); setDetailFrame(0); setDetailPlaying(gridPlaying); returnFocus.current = cards.current[index]; setDetailOpen(true);
        }}>
          <span className="animation-overview__sprite" aria-hidden="true" style={spriteStyle(state.row, frames[index])}/>
          <span>{state.label}</span>
        </button>)}
      </div>
      <p className="animation-overview__hint">Select an animation for a larger preview.</p>
    </section>
    <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} initialFocus={closeButton} returnFocus={returnFocus} contentOverflow="auto" hasCloseButton={false} className="animation-overview__dialog" aria-labelledby={titleId}>
      <div className="animation-overview__header">
        <h2 id={titleId}>{selected.label}</h2>
        <button ref={closeButton} type="button" className="animation-overview__control" aria-label="Close animation preview" onClick={() => setDetailOpen(false)}>Close</button>
      </div>
      <Dialog.Body>
        <div className="animation-overview__large-sprite" role="img" aria-label={`${selected.label} animation preview`} style={spriteStyle(selected.row, detailFrame)}/>
        <p className="animation-overview__status" role="status">{selectedIndex + 1} of {PET_STATES.length} · {detailPlaying ? "Playing" : "Paused"}</p>
      </Dialog.Body>
      <Dialog.Footer>
        <div className="animation-overview__navigation">
          <button type="button" className="animation-overview__control" aria-label="Previous animation" onClick={() => changeAnimation(-1)}>←<span className="animation-overview__nav-label"> Previous</span></button>
          <button type="button" className="animation-overview__control" aria-label={detailPlaying ? "Pause animation" : "Play animation"} onClick={() => setDetailPlaying(playing => !playing)}>{detailPlaying ? "Pause" : "Play"}</button>
          <button type="button" className="animation-overview__control" aria-label="Next animation" onClick={() => changeAnimation(1)}><span className="animation-overview__nav-label">Next </span>→</button>
        </div>
      </Dialog.Footer>
    </Dialog>
  </>;
}
