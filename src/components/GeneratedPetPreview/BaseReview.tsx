"use client";

import {useEffect, useRef, useState} from "react";
import {Button} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {startNewGeneration} from "@/components/PetGenerationForm/request";

export function BaseReview({generationId, expiresAt, disabled, onConfirmed}: {
  generationId: string; expiresAt: string; disabled: boolean; onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const [imageAttempt, setImageAttempt] = useState(0);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(() => Date.parse(expiresAt) <= Date.now());
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => {clearTimeout(timer); controller.current?.abort();};
  }, [expiresAt]);
  async function confirm() {
    if (pending.current || disabled || expired || confirmed || imageState !== "loaded") return;
    pending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(withBasePath(`/api/pet-generations/${generationId}/confirm`), {method: "POST", cache: "no-store", signal: request.signal});
      if (request.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {setExpired(true); return;}
        setError(response.status === 429 ? "Animations could not be queued yet. Your character is saved; try confirming again later." :
          "Could not confirm the animation request. Try again or reload this page; your character will not be generated twice.");
        return;
      }
      const body: unknown = await response.json();
      if (request.signal.aborted) return;
      const generation = body && typeof body === "object" && "generation" in body ? body.generation : null;
      if (!generation || typeof generation !== "object" || !("generationId" in generation) || generation.generationId !== generationId ||
          !("baseConfirmed" in generation) || generation.baseConfirmed !== true || !("status" in generation) ||
          typeof generation.status !== "string" || !["queued", "generating", "processing", "completed", "failed"].includes(generation.status)) {
        throw new Error("invalid_confirmation_receipt");
      }
      setConfirmed(true); onConfirmed();
    } catch {
      if (!request.signal.aborted) setError("Connection interrupted. Confirm again to check the same request; this does not create another task.");
    } finally {
      pending.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return <section className="generated-pet-base">
    <h2>Review your character</h2>
    {!expired && <>
      {/* Keep this private capability URL out of the image optimizer and its cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={imageAttempt} src={withBasePath(`/api/pet-generations/${generationId}/base`)} alt="Generated character awaiting your approval"
        onLoad={() => setImageState("loaded")} onError={() => setImageState("error")} />
    </>}
    {!expired && imageState === "loading" && <p role="status">Loading your character…</p>}
    {!expired && imageState === "error" && <div role="alert">
      <p>Could not load the character. Reload it before starting animations.</p>
      <Button disabled={busy} onClick={() => {setImageState("loading"); setImageAttempt(value => value + 1);}}>Reload character</Button>
    </div>}
    <p>Check the appearance before starting animations. Confirmation does not use another daily attempt.</p>
    <p>Available until {new Date(expiresAt).toLocaleString()}. Confirmation does not extend this deadline.</p>
    {expired ? <p role="status">This generation has expired.</p> :
      <Button view="action" loading={busy} disabled={disabled || confirmed || busy || imageState !== "loaded"} onClick={() => void confirm()}>Animate this character</Button>}
    {confirmed && <p role="status">Animation requested. Refreshing progress…</p>}
    <p><a href={withBasePath("/generate")} onClick={event => {
      if (busy) {event.preventDefault(); return;}
      try {startNewGeneration();} catch {event.preventDefault(); setError("Browser storage is unavailable. Enable it before starting a new attempt.");}
    }}>Start a new generation</a> — a new character uses a new attempt. This one remains available until its deadline.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
