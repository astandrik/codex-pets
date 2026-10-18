"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex, TextArea, TextInput } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { GENERATION_EXPERIMENT_NOTICE } from "@/lib/pets/generation/disclosure";
import { rememberGeneration } from "@/lib/pets/generation/history";
import { prepareGenerationRequest } from "./request";
import "./PetGenerationForm.scss";

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
export function PetGenerationForm({ enabled, reviewBase = false }: { enabled: boolean; reviewBase?: boolean }) {
  const [prompt,setPrompt]=useState(""); const [displayName,setDisplayName]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [preview,setPreview]=useState("");
  const [historyWarning,setHistoryWarning]=useState(false);
  const submitting=useRef(false);
  const [reference, setReference] = useState<{file: File; url: string}>();
  const [referenceError, setReferenceError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = busy || !enabled || Boolean(preview);
  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);
  function selectImage(files: FileList | null) {
    if (locked || !files?.length) return;
    setReference(undefined);
    setReferenceError(false);
    if (files.length !== 1 || !["image/png", "image/jpeg", "image/webp"].includes(files[0].type) || !files[0].size) {
      if (fileInput.current) fileInput.current.value = "";
      setReferenceError(true); setError("Choose one PNG, JPEG or WebP image, or remove it to continue with text only."); return;
    }
    if (files[0].size > 5 * 1024 * 1024) {
      if (fileInput.current) fileInput.current.value = "";
      setReferenceError(true); setError(ERRORS.reference_image_too_large); return;
    }
    setReference({file: files[0], url: URL.createObjectURL(files[0])}); setError("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !enabled || preview || referenceError || (!prompt.trim() && !(reviewBase && reference))) return;
    submitting.current=true; setBusy(true); setError("");
    try {
      const input=await prepareGenerationRequest(sessionStorage,{prompt,displayName,referenceImage:reference?.file});
      let body: string | FormData = JSON.stringify(input);
      if (reviewBase) {
        body = new FormData();
        body.set("prompt", input.prompt); body.set("requestId", input.requestId);
        if (input.displayName) body.set("displayName", input.displayName);
        if (reference) body.set("referenceImage", reference.file);
      }
      const response=await fetch(withBasePath("/api/pet-generations"),{method:"POST",headers:typeof body === "string" ? {"Content-Type":"application/json"} : undefined,body,cache:"no-store"});
      const result: unknown=await response.json();
      if (!response.ok) {
        const code=result && typeof result==="object" && "code" in result && typeof result.code==="string" ? result.code : "generation_unavailable";
        const scope=result&&typeof result==="object"&&"limitScope"in result?result.limitScope:null;
        if(code==="rate_limited"&&(scope==="ip"||scope==="global")) {
          setError(scope==="ip"?"Today's generation limit for your IP address has been reached. Try again after midnight Moscow time.":"Today's generation limit for the whole service has been reached. Try again after midnight Moscow time.");
          return;
        }
        setError(ERRORS[code] ?? "Generation could not be started. Try submitting the same description again.");
        return;
      }
      const generation=result && typeof result==="object" && "generation" in result ? result.generation : null;
      if (!generation || typeof generation!=="object" || !("generationId" in generation) || typeof generation.generationId!=="string" || !/^[a-f0-9]{64}$/.test(generation.generationId)) throw new Error("invalid response");
      setPreview(withBasePath("/generated/"+generation.generationId)); setPrompt(""); setReference(undefined);
      if (fileInput.current) fileInput.current.value = "";
      setHistoryWarning(!rememberGeneration(generation.generationId,"expiresAt"in generation&&typeof generation.expiresAt==="string"?generation.expiresAt:""));
    } catch {
      setError("The connection or browser storage was interrupted. Submit the same description and image again to check the existing request.");
    } finally { submitting.current=false; setBusy(false); }
  }
  return <form onSubmit={submit} className="pet-generation-form">
    <Flex direction="column" gap={4}>
      <Alert theme="warning" title="Experimental feature" message={GENERATION_EXPERIMENT_NOTICE} />
      {reviewBase && <div className="pet-generation-form__reference" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); selectImage(event.dataTransfer.files);}}>
        <label htmlFor="pet-generation-reference">Character image (optional)</label>
        <p>Drop one PNG, JPEG or WebP here, up to 5 MiB. A clear view of one complete character works best.</p>
        <input ref={fileInput} id="pet-generation-reference" type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={event => selectImage(event.target.files)} />
        {reference && <>
          <p>Selected: {reference.file.name}</p>
          {/* A local object URL must not pass through the Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={reference.url} alt="Selected character reference" />
        </>}
        {(reference || referenceError) && <Button type="button" disabled={locked} onClick={() => {
          setReference(undefined); setReferenceError(false); setError("");
          if (fileInput.current) fileInput.current.value = "";
        }}>Remove image</Button>}
        <p>The image defines your character. It is sent to the AI service and stored privately for up to 24 hours; the original is not published.</p>
      </div>}
      <label htmlFor="pet-generation-prompt">{reference ? "What should change? (optional)" : "Describe your pet"}</label>
      {reference && <p>Leave this empty to preserve the character’s appearance. Describe only the changes you want.</p>}
      <TextArea id="pet-generation-prompt" value={prompt} onUpdate={setPrompt} minRows={5} controlProps={{ maxLength: 2000, "aria-required": !reference }} disabled={locked} placeholder={reference ? "Keep the glasses, but make the sweater red…" : "A curious moss-green dragon with amber eyes…"} />
      <label htmlFor="pet-generation-name">Name (optional)</label>
      <TextInput id="pet-generation-name" value={displayName} onUpdate={setDisplayName} controlProps={{ maxLength: 80 }} disabled={busy || !enabled || Boolean(preview)} />
      <p>After the images are ready, one additional AI request chooses a name if left blank and prepares a description and tags. You can edit and save them before moderation.</p>
      <p>One pet at a time. Up to five tasks may wait for up to 30 minutes. Accepted tasks count toward the limit even if generation fails.</p>
      {reviewBase && <p>First, review your character. Animations start only after you confirm it. Creating another character uses a new attempt; confirmation does not.</p>}
      <Button type="submit" view="action" size="l" loading={busy} disabled={!enabled || referenceError || (!prompt.trim() && !reference) || Boolean(preview)}>{reviewBase ? "Create character" : "Generate pet"}</Button>
      {!enabled && <p role="status">Generation is currently disabled.</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <div role="status"><p>Your task has been accepted. Keep its link private.</p><a href={preview}>Open generation progress and preview</a></div>}
      {preview && <p><a href={withBasePath("/my-generations")}>My generations</a></p>}
      {historyWarning && <p role="status">Your task was accepted, but this browser could not save its link. Keep the private link above; do not create another task.</p>}
    </Flex>
  </form>;
}
