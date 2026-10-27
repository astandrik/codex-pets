"use client";

import { useEffect, useRef, useState } from "react";
import { Button, TextArea, TextInput } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { rememberGeneration } from "@/lib/pets/generation/history";
import { prepareGenerationRequest } from "./request";
import { GenerationLimitsDialog } from "./GenerationLimitsDialog";
import "./PetGenerationForm.scss";

const RECOVERY_MESSAGE = "The connection or browser storage was interrupted. Submit the same description and image again to check the existing request.";

const ERRORS: Record<string,string> = {
  rate_limited: "Today's generation limit has been reached. Try again after midnight Moscow time.",
  budget_exhausted: "Today's recorded generation spending limit has been reached. Please try later.",
  queue_full: "The generation queue is full. Please try again later.",
  generation_disabled: "Pet generation is currently disabled.",
  generation_paused: "Generation is paused while a provider request is checked.",
  request_id_conflict: "This request changed during submission. Reload the form before starting a new task.",
  generation_expired: "The previous request has expired. Change the description to start a new task.",
  invalid_reference_image: "Choose a readable, single-frame PNG, JPEG or WebP image, up to 25 million pixels.",
  reference_image_too_large: "Choose an image of 5 MiB or less.",
  body_too_large: "The upload is too large. Choose an image of 5 MiB or less.",
  generation_review_disabled: "Character review is not currently enabled for new tasks. Reload the form to continue.",
};

type FormError = { kind: "image" | "server"; message: string } | { kind: "recovery"; message: string };
type AcceptedTask = { url: string; expiresAt?: string };

export function PetGenerationForm({ enabled, reviewBase = false }: { enabled: boolean; reviewBase?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError>();
  const [accepted, setAccepted] = useState<AcceptedTask>();
  const [historyWarning, setHistoryWarning] = useState(false);
  const [reference, setReference] = useState<{file: File; url: string}>();
  const [draftRevision, setDraftRevision] = useState(0);
  const [recoveryRevision, setRecoveryRevision] = useState<number>();
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = busy || !enabled || Boolean(accepted);
  const imageError = error?.kind === "image";
  const recovering = recoveryRevision !== undefined;
  const unchanged = recovering && recoveryRevision === draftRevision;
  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);

  function editDraft() { setDraftRevision(value => value + 1); }
  function clearImage() {
    if (locked) return;
    setReference(undefined);
    setError(undefined);
    if (fileInput.current) fileInput.current.value = "";
    editDraft();
  }
  function selectImage(files: FileList | null) {
    if (locked || !files?.length) return;
    editDraft();
    setReference(undefined);
    if (files.length !== 1 || !["image/png", "image/jpeg", "image/webp"].includes(files[0].type) || !files[0].size) {
      if (fileInput.current) fileInput.current.value = "";
      setError({kind: "image", message: "Choose one PNG, JPEG or WebP image, or remove it to continue with text only."});
      return;
    }
    if (files[0].size > 5 * 1024 * 1024) {
      if (fileInput.current) fileInput.current.value = "";
      setError({kind: "image", message: ERRORS.reference_image_too_large});
      return;
    }
    setReference({file: files[0], url: URL.createObjectURL(files[0])});
    setError(undefined);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !enabled || accepted || imageError || (!prompt.trim() && !(reviewBase && reference))) return;
    submitting.current = true; setBusy(true); setError(undefined);
    try {
      const input = await prepareGenerationRequest(sessionStorage, {prompt, displayName, referenceImage: reference?.file});
      let body: string | FormData = JSON.stringify(input);
      if (reviewBase) {
        body = new FormData(); body.set("prompt", input.prompt); body.set("requestId", input.requestId);
        if (input.displayName) body.set("displayName", input.displayName);
        if (reference) body.set("referenceImage", reference.file);
      }
      const response = await fetch(withBasePath("/api/pet-generations"), {method: "POST", headers: typeof body === "string" ? {"Content-Type": "application/json"} : undefined, body, cache: "no-store"});
      const result: unknown = await response.json();
      if (!response.ok) {
        const code = result && typeof result === "object" && "code" in result && typeof result.code === "string" ? result.code : "generation_unavailable";
        const scope = result && typeof result === "object" && "limitScope" in result ? result.limitScope : null;
        let message = ERRORS[code] ?? "Generation could not be started. Try submitting the same description again.";
        if (code === "rate_limited" && scope === "ip") message = "Today's generation limit for your IP address has been reached. Try again after midnight Moscow time.";
        if (code === "rate_limited" && scope === "global") message = "Today's generation limit for the whole service has been reached. Try again after midnight Moscow time.";
        // A later HTTP error cannot resolve an earlier uncertain submission.
        setError({kind: "server", message});
        return;
      }
      const generation = result && typeof result === "object" && "generation" in result ? result.generation : null;
      if (!generation || typeof generation !== "object" || !("generationId" in generation) || typeof generation.generationId !== "string" || !/^[a-f0-9]{64}$/.test(generation.generationId)) throw new Error("invalid response");
      const expiresAt = "expiresAt" in generation && typeof generation.expiresAt === "string" ? generation.expiresAt : "";
      setRecoveryRevision(undefined);
      setAccepted({url: withBasePath("/generated/" + generation.generationId), expiresAt: Number.isFinite(Date.parse(expiresAt)) ? expiresAt : undefined});
      setPrompt(""); setDisplayName(""); setReference(undefined);
      if (fileInput.current) fileInput.current.value = "";
      setHistoryWarning(!rememberGeneration(generation.generationId, expiresAt));
    } catch {
      setRecoveryRevision(draftRevision);
      setError({kind: "recovery", message: RECOVERY_MESSAGE});
    } finally { submitting.current = false; setBusy(false); }
  }

  const submitButton = <Button type="submit" view="action" size="xl" width="max" loading={busy} disabled={!enabled || imageError || (!prompt.trim() && !(reviewBase && reference)) || Boolean(accepted)}>{recovering ? unchanged ? "Retry unchanged request" : "Submit changed request" : reviewBase ? "Create character" : "Generate pet"}</Button>;
  return <div className="pet-generation-screen">
    <header className="pet-generation-screen__intro">
      <span className="pet-generation-screen__eyebrow">CREATE A PET</span>
      <h1>{accepted ? "Your pet is on its way" : reviewBase ? "Create your character" : "Generate a pet"}</h1>
      <p>{accepted ? "Your task has been accepted. Keep its link private." : reviewBase ? "Describe a pet, add a reference, or use both. No account needed." : "Describe your pet to create all nine animations. No account needed."}</p>
    </header>
    {reviewBase && !accepted && <ol className="pet-generation-screen__stages" aria-label="Generation stages"><li aria-current="step">1 Create character</li><li>2 Review</li><li>3 Animate</li></ol>}
    <div className="pet-generation-screen__columns">
      <form onSubmit={submit} className="pet-generation-form" aria-label="Pet generation">
        {accepted ? <div className="pet-generation-form__accepted" role="status">
          <h2>Task accepted</h2>
          <p>{reviewBase ? "Follow progress and review your character before its animations are created." : "Follow progress and preview your animated pet."}</p>
          {historyWarning && <p className="pet-generation-form__notice">Your task was accepted, but this browser could not save its link. Keep the private link below; do not create another task.</p>}
          <a className="pet-generation-form__progress" href={accepted.url}>Open generation progress and preview</a>
          <a href={withBasePath("/my-generations")}>My generations</a>
          <p>{accepted.expiresAt ? <>Available until <time dateTime={accepted.expiresAt}>{new Date(accepted.expiresAt).toLocaleString()}</time>.</> : "Available for 24 hours from task acceptance, including time in the queue."}</p>
        </div> : <>
          {(error || recovering) && !imageError && <div role="alert" className="pet-generation-form__notice">
            <strong>{recovering ? "We could not confirm the request" : "Generation could not be started"}</strong>
            <p>{error?.message ?? RECOVERY_MESSAGE}</p>
            {recovering && <><p>{unchanged ? "Your request may already exist. Retry with the same description, image and name to avoid a second task." : "Your draft has changed. Submitting it may create a new task."}</p>{submitButton}</>}
          </div>}
          <div className="pet-generation-form__label"><label htmlFor="pet-generation-prompt">{reference ? "What should change? (optional)" : "Describe your pet"}</label><span id="pet-generation-count" aria-live="off">{prompt.length} / 2000</span></div>
          <TextArea id="pet-generation-prompt" value={prompt} onUpdate={value => {setPrompt(value); editDraft();}} size="l" minRows={5} controlProps={{maxLength: 2000, "aria-required": !reference, "aria-describedby": "pet-generation-count"}} disabled={locked} placeholder={reference ? "Keep the glasses, but make the sweater red…" : "An orange fox with a green scarf, soft fur and a curious expression…"} />
          {reference && <p className="pet-generation-form__hint">Leave this blank to keep the appearance in your reference.</p>}
          {reviewBase && <div className="pet-generation-form__reference" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); selectImage(event.dataTransfer.files);}}>
            <input ref={fileInput} id="pet-generation-reference" className="pet-generation-form__file" type="file" aria-label="Character image (optional)" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={event => selectImage(event.target.files)} />
            {reference ? <>
              <div className="pet-generation-form__file-info">
                {/* The local reference must not pass through the Next image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={reference.url} alt="Selected character reference" />
                <span>{reference.file.name}</span>
              </div>
              <div className="pet-generation-form__file-actions">
                <Button type="button" view="outlined" size="xl" aria-label="Replace image" disabled={locked} onClick={() => fileInput.current?.click()}>Replace</Button>
                <Button type="button" view="outlined" size="xl" aria-label="Remove image" disabled={locked} onClick={clearImage}>Remove</Button>
              </div>
            </> : <>
              <div className="pet-generation-form__choose"><span>Reference image<small>Optional</small></span><Button type="button" view="outlined" size="l" disabled={locked} onClick={() => fileInput.current?.click()}>Choose image</Button></div>
              <p className="pet-generation-form__hint">Drop one image here · PNG, JPEG or WebP · up to 5 MiB</p>
            </>}
            {imageError && <div role="alert" className="pet-generation-form__image-error"><p>{error.message}</p><Button type="button" view="outlined" disabled={locked} onClick={clearImage}>Use description only</Button></div>}
            <p className="pet-generation-form__hint">Sent to AI when you submit. Private for up to 24h.</p>
          </div>}
          <Button type="button" view="outlined" size="xl" width="max" className="pet-generation-form__name-toggle" aria-expanded={nameOpen} aria-controls="pet-generation-name-panel" onClick={() => setNameOpen(value => !value)}>{nameOpen ? "Pet name (optional) −" : "Add a name (optional) +"}</Button>
          <div id="pet-generation-name-panel" hidden={!nameOpen}>
            <label htmlFor="pet-generation-name" className="pet-generation-form__sr-only">Name (optional)</label>
            <TextInput id="pet-generation-name" value={displayName} onUpdate={value => {setDisplayName(value); editDraft();}} size="xl" controlProps={{maxLength: 80, enterKeyHint: "done"}} disabled={locked} onKeyDown={event => {if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {event.preventDefault(); event.currentTarget.blur();}}} />
            <p className="pet-generation-form__hint">Up to 80 characters. Leave blank to suggest a name automatically.</p>
          </div>
          <div className="pet-generation-form__submit">
            {!recovering && submitButton}
            <p className="pet-generation-form__hint">{reviewBase ? "You will review your character before animation starts." : "Your pet will appear on its private generation page."}</p>
            {!enabled && <p role="status">Generation is currently disabled.</p>}
            {busy && <p role="status">Sending your request. This can take a moment.</p>}
          </div>
          <p className="pet-generation-form__hint"><strong>Experimental feature:</strong> animations and gaze directions may contain visual errors. Accepted tasks count toward limits even if the result is unsuitable.</p>
          <Button type="button" view="outlined" size="l" width="max" onClick={() => setLimitsOpen(true)}>Limits & privacy</Button>
        </>}
      </form>
      <aside className="pet-generation-screen__aside">
        <div className="pet-generation-screen__steps"><h2>{accepted ? "Your private workspace" : "What happens next"}</h2>
          <ol>{(accepted ? [["Follow progress", "Open the task page for the queue and generation status."], ["Review before sharing", "You control when a result is sent to gallery moderation."]] : reviewBase ? [["Create", "We turn your idea into a character preview."], ["Review", "Keep it, or adjust its appearance first."], ["Animate", "Create all nine animations, then download your pet."]] : [["Generate", "Create the character and all animation states."], ["Review and download", "Inspect your pet before sharing it."]]).map(([title, description]) => <li key={title}><strong>{title}</strong><p>{description}</p></li>)}</ol>
        </div>
        <nav aria-label="Generation resources"><a href={withBasePath("/my-generations")}>My generations →</a><a href={withBasePath("/guides/ai-pet-generator")}>Read the generation guide ↗</a><a href={withBasePath("/request")}>Prefer a manual request? ↗</a></nav>
      </aside>
    </div>
    <GenerationLimitsDialog open={limitsOpen} onClose={() => setLimitsOpen(false)} reviewBase={reviewBase} />
  </div>;
}
