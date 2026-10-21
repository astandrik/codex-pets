"use client";

import {useEffect, useRef, useState} from "react";
import {Button, TextArea} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {BaseRefinement} from "./BaseRefinement";
import {startNewGeneration} from "@/components/PetGenerationForm/request";

export function BaseReview({generationId, expiresAt, disabled, animationHintsEnabled = false, onConfirmed, onEditingChange, onAnimationPromptIntent}: {
  generationId: string; expiresAt: string; disabled: boolean; animationHintsEnabled?: boolean; onConfirmed: (differentAnimationPrompt?: boolean) => void; onEditingChange: (editing: boolean) => void; onAnimationPromptIntent?: (prompt: string) => void;
}) {
  const [animationPrompt, setAnimationPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [differentPrompt, setDifferentPrompt] = useState(false);
  const [refining, setRefining] = useState(false);
  const refinementPending = useRef(false);
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
    if (pending.current || refinementPending.current || disabled || expired || confirmed || imageState !== "loaded") return;
    pending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    const first = submittedPrompt === null;
    const input = submittedPrompt ?? (animationHintsEnabled ? animationPrompt.replace(/\r\n?/g, "\n").trim() : "");
    setSubmittedPrompt(input); onAnimationPromptIntent?.(input);
    try {
      const response = await fetch(withBasePath(`/api/pet-generations/${generationId}/confirm`), {method: "POST", ...(input ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify({animationPrompt: input})} : {}), cache: "no-store", signal: request.signal});
      if (request.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {setExpired(true); return;}
        const failure: unknown = await response.json();
        if (request.signal.aborted) return;
        const code = failure && typeof failure === "object" && "code" in failure ? failure.code : undefined;
        if (first && typeof code === "string" && ["queue_full", "budget_exhausted", "generation_disabled", "generation_paused", "animation_hints_disabled", "saved_stage_unavailable", "invalid_argument", "body_too_large"].includes(code)) setSubmittedPrompt(null);
        setError(code === "animation_hints_disabled" ? "Пожелания пока недоступны. Очистите поле, чтобы запустить стандартные анимации." : response.status === 429 ? "Animations could not be queued yet. Your character is saved; try confirming again later." :
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
      const savedPrompt = "animationPrompt" in generation ? generation.animationPrompt : undefined;
      if (savedPrompt !== undefined && (typeof savedPrompt !== "string" || savedPrompt.length > 2000)) throw new Error("invalid_confirmation_receipt");
      const accepted = typeof savedPrompt === "string" ? savedPrompt : "";
      const different = accepted !== input;
      setAnimationPrompt(accepted); setSubmittedPrompt(accepted); setDifferentPrompt(different);
      setConfirmed(true); onConfirmed(different);
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
    {animationHintsEnabled && !expired && <div className="generated-pet-animation-hints">
      <label htmlFor={`animation-prompt-${generationId}`}>Как должен двигаться персонаж?</label>
      <TextArea id={`animation-prompt-${generationId}`} value={submittedPrompt ?? animationPrompt} onUpdate={value => {
          setAnimationPrompt(value);
          onAnimationPromptIntent?.(submittedPrompt ?? value.replace(/\r\n?/g, "\n").trim());
        }} minRows={3}
        disabled={disabled || confirmed || busy || refining || submittedPrompt !== null || imageState !== "loaded"}
        controlProps={{maxLength: 2000, "aria-describedby": `animation-help-${generationId}`}}
        placeholder="При движении вправо голова поворачивается вправо, влево — влево. При прыжке поджимает лапы. В покое оглядывается." />
      <p id={`animation-help-${generationId}`}>Необязательно. Опишите движения, повороты и жесты для разных состояний. Внешность берётся из этого образа. Изменение размера и реакция головы на курсор пока не поддерживаются. Черновик не сохраняется после закрытия страницы.</p>
    </div>}
    {differentPrompt && <p role="status">Анимации уже подтверждены в другой вкладке с другими пожеланиями. Показан сохранённый вариант.</p>}
    {expired ? <p role="status">This generation has expired.</p> :
      <Button view="action" loading={busy} disabled={disabled || confirmed || busy || refining || imageState !== "loaded"} onClick={() => void confirm()}>{submittedPrompt && !confirmed ? "Check animation request" : "Animate this character"}</Button>}
    <BaseRefinement generationId={generationId} disabled={expired || disabled || confirmed || busy || imageState !== "loaded"} blocked={busy} onEditingChange={onEditingChange}
      onPendingChange={value => {refinementPending.current = value; setRefining(value);}} />
    {confirmed && <p role="status">Animation requested. Refreshing progress…</p>}
    <p><a href={withBasePath("/generate")} onClick={event => {
      if (busy || refinementPending.current) {event.preventDefault(); return;}
      try {startNewGeneration();} catch {event.preventDefault(); setError("Browser storage is unavailable. Enable it before starting a new attempt.");}
    }}>Start a new generation</a> — a new character uses a new attempt. This one remains available until its deadline.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
