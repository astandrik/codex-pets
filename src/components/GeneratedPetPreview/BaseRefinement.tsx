"use client";

import {useEffect, useRef, useState} from "react";
import {Button, TextArea} from "@gravity-ui/uikit";
import {useRouter} from "next/navigation";
import {withBasePath} from "@/lib/base-path";
import {rememberGeneration} from "@/lib/pets/generation/history";
import {publicGenerationError} from "@/lib/pets/generation/public-error";
import {prepareGenerationRequest, startNewGeneration} from "@/components/PetGenerationForm/request";

type Props = {generationId: string; disabled: boolean; blocked: boolean; onPendingChange: (pending: boolean) => void; onEditingChange: (editing: boolean) => void};

export function BaseRefinement(props: Props) {
  const [editing, setEditing] = useState(false);
  return editing ? <RefinementForm {...props} onCancel={() => {setEditing(false); props.onEditingChange(false);}} /> :
    <Button type="button" disabled={props.disabled} onClick={() => {setEditing(true); props.onEditingChange(true);}}>Edit character</Button>;
}

function RefinementForm({generationId, disabled, blocked, onPendingChange, onCancel}: Props & {onCancel: () => void}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acceptedUrl, setAcceptedUrl] = useState("");
  const [submitted, setSubmitted] = useState<{prompt: string; requestId: string} | null>(null);
  const checkingSubmitted = disabled && submitted !== null;
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || blocked || acceptedUrl || (disabled ? !submitted : !prompt.trim())) return;
    pending.current = true; setBusy(true); onPendingChange(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      // An unavailable/confirmed source permits replay of the exact submitted request only.
      const input = disabled && submitted ? submitted : await prepareGenerationRequest(sessionStorage, {prompt, sourceBaseId: generationId});
      if (request.signal.aborted) return;
      setSubmitted({prompt: input.prompt, requestId: input.requestId});
      const response = await fetch(withBasePath(`/api/pet-generations/${generationId}/refine`), {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(input), cache: "no-store", signal: request.signal,
      });
      const result: unknown = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) {
        const code = result && typeof result === "object" && "code" in result && typeof result.code === "string" ? result.code : "generation_unavailable";
        const scope = result && typeof result === "object" && "limitScope" in result ? result.limitScope : undefined;
        const detail = publicGenerationError(code, undefined, scope === "ip" || scope === "global" ? scope : undefined);
        setError(detail.message + " " + detail.hint); return;
      }
      const generation = result && typeof result === "object" && "generation" in result ? result.generation : null;
      if (!generation || typeof generation !== "object" || !("generationId" in generation) || typeof generation.generationId !== "string" ||
          !/^[a-f0-9]{64}$/.test(generation.generationId) || generation.generationId === generationId ||
          !("expiresAt" in generation) || typeof generation.expiresAt !== "string" || !Number.isFinite(Date.parse(generation.expiresAt))) throw Error("invalid_refinement_receipt");
      const url = withBasePath(`/generated/${generation.generationId}?from=${generationId}`);
      setAcceptedUrl(url);
      rememberGeneration(generation.generationId, generation.expiresAt);
      try {startNewGeneration();} catch { /* The accepted version remains available through its link. */ }
      router.push(url);
    } catch {
      if (!request.signal.aborted) setError("Connection interrupted. Submit the same edit again to check the existing version; this will not create another attempt.");
    } finally {
      pending.current = false;
      if (!request.signal.aborted) {setBusy(false); onPendingChange(false);}
    }
  }

  return <form className="generated-pet-refinement" onSubmit={event => void submit(event)}>
    <label htmlFor={`refinement-${generationId}`}>What should change?</label>
    <TextArea id={`refinement-${generationId}`} value={checkingSubmitted ? submitted.prompt : prompt} onUpdate={setPrompt} minRows={3}
      controlProps={{maxLength: 2000, "aria-required": true}} disabled={disabled || busy || Boolean(acceptedUrl)} placeholder="Keep everything else, but make the scarf red…" />
    <p>The current character is the reference. A new version uses one daily attempt and has its own 24 hours. This version stays available until its original deadline.</p>
    {checkingSubmitted && <p>The source is no longer available for new edits. You can still check the exact edit already submitted.</p>}
    <p>Only the character is generated now. You choose a version before starting animations.</p>
    <div>
      <Button type="submit" view="action" loading={busy} disabled={blocked || busy || (disabled ? !submitted : !prompt.trim()) || Boolean(acceptedUrl)}>{checkingSubmitted ? "Check submitted version" : "Create new version"}</Button>{" "}
      <Button type="button" disabled={busy} onClick={onCancel}>Cancel edit</Button>
    </div>
    {error && <p role="alert">{error}</p>}
    {acceptedUrl && <p role="status">Your new version was accepted. <a href={acceptedUrl}>Open new version</a></p>}
  </form>;
}
