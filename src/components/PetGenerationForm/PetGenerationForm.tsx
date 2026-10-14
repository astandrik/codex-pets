"use client";

import { useRef, useState } from "react";
import { Alert, Button, Flex, TextArea, TextInput } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { GENERATION_EXPERIMENT_NOTICE } from "@/lib/pets/generation/disclosure";
import { rememberGeneration } from "@/lib/pets/generation/history";
import { prepareGenerationRequest } from "./request";
import "./PetGenerationForm.scss";

const ERRORS: Record<string,string> = {
  rate_limited: "Today's generation limit has been reached. Try again after midnight Moscow time.",
  budget_exhausted: "Today's generation budget is fully allocated. Please try later.",
  queue_full: "The generation queue is full. Please try again later.",
  generation_disabled: "Pet generation is currently disabled.",
  generation_paused: "Generation is paused while a provider request is checked.",
  request_id_conflict: "This request changed during submission. Reload the form before starting a new task.",
  generation_expired: "The previous request has expired. Change the description to start a new task.",
};
export function PetGenerationForm({ enabled }: { enabled: boolean }) {
  const [prompt,setPrompt]=useState(""); const [displayName,setDisplayName]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [preview,setPreview]=useState("");
  const [historyWarning,setHistoryWarning]=useState(false);
  const submitting=useRef(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !enabled || !prompt.trim()) return;
    submitting.current=true; setBusy(true); setError("");
    try {
      const input=await prepareGenerationRequest(sessionStorage,{prompt,displayName});
      const response=await fetch(withBasePath("/api/pet-generations"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),cache:"no-store"});
      const body: unknown=await response.json();
      if (!response.ok) {
        const code=body && typeof body==="object" && "code" in body && typeof body.code==="string" ? body.code : "generation_unavailable";
        const scope=body&&typeof body==="object"&&"limitScope"in body?body.limitScope:null;
        if(code==="rate_limited"&&(scope==="ip"||scope==="global")) {
          setError(scope==="ip"?"Today's generation limit for your IP address has been reached. Try again after midnight Moscow time.":"Today's generation limit for the whole service has been reached. Try again after midnight Moscow time.");
          return;
        }
        setError(ERRORS[code] ?? "Generation could not be started. Try submitting the same description again.");
        return;
      }
      const generation=body && typeof body==="object" && "generation" in body ? body.generation : null;
      if (!generation || typeof generation!=="object" || !("generationId" in generation) || typeof generation.generationId!=="string" || !/^[a-f0-9]{64}$/.test(generation.generationId)) throw new Error("invalid response");
      setPreview(withBasePath("/generated/"+generation.generationId)); setPrompt("");
      setHistoryWarning(!rememberGeneration(generation.generationId,"expiresAt"in generation&&typeof generation.expiresAt==="string"?generation.expiresAt:""));
    } catch {
      setError("The connection or browser storage was interrupted. Submit the same description again to check the existing request.");
    } finally { submitting.current=false; setBusy(false); }
  }
  return <form onSubmit={submit} className="pet-generation-form">
    <Flex direction="column" gap={4}>
      <Alert theme="warning" title="Experimental feature" message={GENERATION_EXPERIMENT_NOTICE} />
      <label htmlFor="pet-generation-prompt">Describe your pet</label>
      <TextArea id="pet-generation-prompt" value={prompt} onUpdate={setPrompt} minRows={5} controlProps={{ maxLength: 2000, "aria-required": true }} disabled={busy || !enabled || Boolean(preview)} placeholder="A curious moss-green dragon with amber eyes…" />
      <label htmlFor="pet-generation-name">Name (optional)</label>
      <TextInput id="pet-generation-name" value={displayName} onUpdate={setDisplayName} controlProps={{ maxLength: 80 }} disabled={busy || !enabled || Boolean(preview)} />
      <p>After the images are ready, one additional AI request chooses a name if left blank and prepares a description and tags. You can edit and save them before moderation.</p>
      <p>One pet at a time. Up to five tasks may wait for up to 30 minutes. Accepted tasks count toward the limit even if generation fails. No automatic paid retries.</p>
      <Button type="submit" view="action" size="l" loading={busy} disabled={!enabled || !prompt.trim() || Boolean(preview)}>Generate pet</Button>
      {!enabled && <p role="status">Generation is currently disabled.</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <div role="status"><p>Your task has been accepted. Keep its link private.</p><a href={preview}>Open generation progress and preview</a></div>}
      {preview && <p><a href={withBasePath("/my-generations")}>My generations</a></p>}
      {historyWarning && <p role="status">Your task was accepted, but this browser could not save its link. Keep the private link above; do not create another task.</p>}
    </Flex>
  </form>;
}
