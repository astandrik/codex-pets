"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Container, TextInput } from "@gravity-ui/uikit";
import { StatePreview } from "@/components/StatePreview/StatePreview";
import { toPublicUrl, withBasePath } from "@/lib/base-path";
import { parsePublicPetSlug, suggestPublicPetSlug } from "@/lib/pets/public-slug";
import type { PublicGeneration } from "@/lib/pets/generation/service";
import { publicGenerationError } from "@/lib/pets/generation/public-error";
import {GeneratedPetMetadataEditor} from "@/components/GeneratedPetMetadataEditor/GeneratedPetMetadataEditor";
import { rememberGeneration } from "@/lib/pets/generation/history";
import {BaseReview} from "./BaseReview";
import "./GeneratedPetPreview.scss";

const STATUS_LABELS = { queued: "Waiting in the queue", generating: "Creating your pet", awaiting_confirmation: "Your character is ready for review", processing: "Checking and packaging your pet", completed: "Your pet is ready", failed: "Generation could not be completed" };
type Submission = NonNullable<PublicGeneration["submission"]>;
type SlugCheck = { slug: string; status: "checking" | "available" | "error"; available?: boolean; suggestedSlug?: string; message?: string };

function readSubmission(value: unknown): Submission | null {
  if (!value || typeof value !== "object" || !("slug" in value) ||
      !("petId" in value) || typeof value.petId !== "string" || !("submittedAt" in value) || typeof value.submittedAt !== "string") return null;
  const slug = parsePublicPetSlug(value.slug);
  return slug ? { petId: value.petId, slug, submittedAt: value.submittedAt } : null;
}

export function GeneratedPetPreview({ generationId }: { generationId: string }) {
  return <GeneratedPetPreviewContent key={generationId} generationId={generationId} />;
}

function GeneratedPetPreviewContent({ generationId }: { generationId: string }) {
  const files = withBasePath(`/api/pet-generations/${generationId}/files/`);
  const [generation, setGeneration] = useState<PublicGeneration | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [submission, setSubmission] = useState<Submission>();
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [slug, setSlug] = useState("");
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);
  const [slugNotice, setSlugNotice] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [metadataBlocked,setMetadataBlocked]=useState(false);
  const [metadataConflict,setMetadataConflict]=useState(false);
  const metadataBlockedRef=useRef(false);
  const pendingSubmission = useRef(false);
  const savedSubmission = useRef<Submission | undefined>(undefined);
  const initializedSlug = useRef(false);
  const editedSlug = useRef(false);
  const checkSequence = useRef(0);
  const submissionController = useRef<AbortController | null>(null);
  useEffect(() => () => submissionController.current?.abort(), []);
  useEffect(() => {
    if (generation?.status !== "awaiting_confirmation") return;
    const refresh = () => {if (!document.hidden) setRefreshVersion(value => value + 1);};
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);};
  }, [generation?.status]);

  const rememberSubmission = useCallback((receipt: Submission) => {
    savedSubmission.current = receipt;
    checkSequence.current++;
    setSubmission(receipt);
    setSlug(receipt.slug);
    setSlugCheck(null);
    setSlugNotice("");
    setSubmissionError("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function poll() {
      try {
        const response = await fetch(withBasePath(`/api/pet-generations/${generationId}`), { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const expired = response.status === 410 || response.status === 404;
          if (expired) {
            setUnavailable(true);
            setError("This generation is unavailable or has expired.");
            return;
          }
          throw new Error("generation_status_unavailable");
        }
        const body: { generation: PublicGeneration } = await response.json();
        if (controller.signal.aborted) return;
        setGeneration(body.generation);
        setError(""); setUnavailable(false);
        rememberGeneration(generationId,body.generation.expiresAt);
        if (body.generation.submission) {
          rememberSubmission(body.generation.submission);
        } else if (body.generation.pet && !initializedSlug.current && !editedSlug.current && !savedSubmission.current) {
          initializedSlug.current = true;
          setSlug(suggestPublicPetSlug(body.generation.pet.displayName));
        }
        failures = 0;
        if (body.generation.pollAfterSeconds) timer = setTimeout(poll, body.generation.pollAfterSeconds * 1000);
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
        if (failures < 3) timer = setTimeout(poll, 5000);
        else setError("Connection interrupted. Reload to check your generation.");
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [generationId, rememberSubmission, refreshVersion]);

  useEffect(() => {
    const sequence = ++checkSequence.current;
    if (generation?.status !== "completed" || unavailable || submission || !parsePublicPetSlug(slug)) {
      return;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sequence === checkSequence.current && !savedSubmission.current && !pendingSubmission.current;
    const timer = setTimeout(async () => {
      if (!current()) return;
      setSlugCheck({ slug, status: "checking" });
      try {
        const response = await fetch(withBasePath(`/api/pet-generations/${generationId}/submission/slug-check`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }),
          cache: "no-store", signal: controller.signal,
        });
        if (!current()) return;
        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            setUnavailable(true); setSubmissionError("This generation is unavailable or has expired.");
          } else setSlugCheck({ slug, status: "error", message: "Could not check this public URL. Try again." });
          return;
        }
        const result: { available: boolean; suggestedSlug: string; submission?: unknown } = await response.json();
        if (!current()) return;
        const receipt = readSubmission(result.submission);
        if (receipt) {
          rememberSubmission(receipt);
          return;
        }
        if (result.available === true && result.suggestedSlug === slug) {
          setSlugCheck({ slug, status: "available", available: true, suggestedSlug: slug });
          setSlugNotice("");
        } else if (result.available === false && parsePublicPetSlug(result.suggestedSlug) && result.suggestedSlug !== slug) {
          setSlugNotice(`“${slug}” is already taken. The suggested URL name is “${result.suggestedSlug}”.`);
          setSlugCheck({ slug, status: "available", available: false, suggestedSlug: result.suggestedSlug });
        } else setSlugCheck({ slug, status: "error", message: "Choose another public URL and try again." });
      } catch {
        if (current()) setSlugCheck({ slug, status: "error", message: "Could not check this public URL. Try again." });
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [generation?.status, generationId, slug, submission, unavailable, checkAttempt, rememberSubmission]);

  function updateSlug(value: string) {
    if (savedSubmission.current || pendingSubmission.current) return;
    editedSlug.current = true;
    checkSequence.current++;
    setSlug(value); setSlugCheck(null); setSlugNotice(""); setSubmissionError("");
  }

  async function submitForReview() {
    if (pendingSubmission.current || savedSubmission.current || metadataBlockedRef.current || metadataConflict || unavailable || generation?.status !== "completed" ||
        !parsePublicPetSlug(slug) || slugCheck?.status !== "available" || slugCheck.slug !== slug) return;
    pendingSubmission.current = true;
    const controller = new AbortController();
    submissionController.current = controller;
    const current = () => !controller.signal.aborted;
    checkSequence.current++;
    setSubmitting(true); setSubmissionError("");
    try {
      const response = await fetch(withBasePath(`/api/pet-generations/${generationId}/submission`), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, ...(generation.metadata?{metadataRevision:generation.metadata.revision}:{}) }), cache: "no-store", signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        if(response.status===409){
          let errorBody:unknown;try{errorBody=await response.json();}catch{/* Older servers may not return JSON errors. */}
          if(!current())return;
          if(errorBody&&typeof errorBody==="object"&&"code"in errorBody&&errorBody.code==="metadata_conflict"){
            setMetadataConflict(true);setSubmissionError("Name, description or tags changed in another tab. Reload the saved details before submitting.");return;
          }
        }
        const expired = response.status === 410 || response.status === 404;
        if (expired) setUnavailable(true);
        setSubmissionError(expired ? "This generation is unavailable or has expired." : response.status === 422 ?
          "This package could not be validated for submission." : response.status === 400 || response.status === 409 ?
          "This public URL could not be saved. Check it or choose another one." :
          "Could not confirm submission. Reload to check the saved description, tags and address before trying again; the same pet will not be submitted twice.");
        return;
      }
      const result: { submission: unknown } = await response.json();
      if (!current()) return;
      const receipt = readSubmission(result.submission);
      if (!receipt) throw new Error("invalid_submission_response");
      rememberSubmission(receipt);
      if(generation.metadata){
        try{
          const refreshed=await fetch(withBasePath(`/api/pet-generations/${generationId}`),{cache:"no-store",signal:controller.signal});
          if(refreshed.ok){const body:{generation:PublicGeneration}=await refreshed.json();if(current())setGeneration(body.generation);}
        }catch{/* The confirmed receipt remains authoritative; reloading reads the final details. */}
      }
    } catch {
      if (current()) setSubmissionError("Connection interrupted. Try again; the same pet will not be submitted twice.");
    } finally {
      if (current()) { pendingSubmission.current = false; submissionController.current = null; setSubmitting(false); }
    }
  }

  const validSlug = parsePublicPetSlug(slug);
  const checked = slugCheck?.slug === slug && slugCheck.status === "available";
  const checkingSlug = slugCheck?.slug !== slug || slugCheck.status === "checking";
  const previewSlug = submission?.slug ?? (checked ? slugCheck.suggestedSlug : validSlug);
  const futureURL = previewSlug ? toPublicUrl(`/pets/${previewSlug}`) : null;
  const failed = generation?.status === "failed";
  const failure = generation?.error?.message ? generation.error : publicGenerationError(generation?.error?.code ?? "generation_unavailable");
  return <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
    <p><a href={withBasePath("/my-generations")}>My generations</a></p>
    <h1>{generation?.pet?.displayName ?? "Generated pet"}</h1>
    {generation?.status==="processing"&&generation.metadata?.automaticState==="inflight"&&<p role="status">Preparing the name, description and tags…</p>}
    {generation?.status==="completed"&&generation.metadata&&<GeneratedPetMetadataEditor generationId={generationId} metadata={generation.metadata} disabled={Boolean(submission)||submitting||unavailable} onBlocked={value=>{metadataBlockedRef.current=value;setMetadataBlocked(value);}} onSaved={metadata=>{setMetadataConflict(false);setGeneration(current=>current?{...current,metadata,pet:current.pet?{...current.pet,displayName:metadata.displayName??current.pet.displayName}:current.pet}:current);if(metadata.displayName&&!editedSlug.current&&!savedSubmission.current&&suggestPublicPetSlug(metadata.displayName)!==slug){checkSequence.current++;setSlug(suggestPublicPetSlug(metadata.displayName));setSlugCheck(null);setSlugNotice("");}}}/>}
    <p role="status" aria-live="polite">{error || (generation ? STATUS_LABELS[generation.status] : "Loading generation…")}</p>
    {generation?.progress && generation.status !== "failed" && <p>{generation.progress.completedSteps} of {generation.progress.totalSteps} generation steps completed.</p>}
    {failed && <div role="alert"><p>{failure.message}</p><p>{failure.hint}</p></div>}
    {generation?.status === "awaiting_confirmation" && <BaseReview generationId={generationId} expiresAt={generation.expiresAt} disabled={unavailable} onConfirmed={() => setRefreshVersion(value => value + 1)} />}
    {generation?.pet && generation.status === "completed" && <>
      <StatePreview petJsonUrl={files + "pet.json"} spritesheetUrl={files + "spritesheet.webp"} />
      {!metadataBlocked&&<p><a href={files + "pet.zip"}>Download pet ZIP</a></p>}
      {!metadataBlocked&&<p><a href={files + "pet.json"}>pet.json</a> · <a href={files + "spritesheet.webp"}>Spritesheet</a></p>}
      <p>Download before {new Date(generation.expiresAt).toLocaleString()}. Keep this link private.</p>
      <form className="generated-pet-publication" onSubmit={(event) => { event.preventDefault(); void submitForReview(); }}>
        <label htmlFor="generated-pet-public-slug">Public URL name</label>
        <TextInput id="generated-pet-public-slug" value={slug} onUpdate={updateSlug}
          disabled={submitting || unavailable} validationState={slug && !validSlug ? "invalid" : undefined}
          controlProps={{ maxLength: 64, readOnly: Boolean(submission), autoCapitalize: "none", autoCorrect: "off", spellCheck: false,
            "aria-describedby": "generated-pet-slug-help generated-pet-public-url", "aria-required": true }} />
        <p id="generated-pet-slug-help">Use 1–64 lowercase Latin letters, digits or hyphens, without a leading or trailing hyphen.</p>
        <p id="generated-pet-public-url" className="generated-pet-publication__url">
          {submission ? "Saved public URL: " : "Future public URL: "}{futureURL ? <code>{futureURL}</code> : "Enter a URL name above."}
        </p>
        {submission ? <p role="status" aria-live="polite">Sent for review. This URL is fixed and becomes available after approval. Its gallery package has been saved beyond this private link’s expiry.</p> : <>
          <p>This pet is not in the gallery. Submit it to moderation to save a gallery copy; it becomes public only after approval.</p>
          {slugNotice && <p role="status">{slugNotice}</p>}
          {!validSlug && <p role="status">Enter a valid public URL name to continue.</p>}
          {validSlug && !unavailable && <p role="status" aria-live="polite">{checkingSlug ? "Checking this URL…" : slugCheck?.status === "available" ?
            (slugCheck.available ? "This URL is available. It is saved only when you submit for review." :
              "A suffix will be added when you submit. Availability checks do not reserve a URL.") : slugCheck?.message}</p>}
          {slugCheck?.slug === slug && slugCheck.status === "error" && !unavailable && <Button type="button" onClick={() => { setSlugCheck(null); setCheckAttempt((value) => value + 1); }}>Check again</Button>}
          <Button type="submit" view="action" loading={submitting} disabled={submitting || unavailable || metadataBlocked || metadataConflict || !checked || !validSlug}>Submit for review</Button>
        </>}
        {metadataBlocked&&<p>Save the name, description and tags before submitting.</p>}
        {submissionError && <p role="alert">{submissionError}</p>}
        {metadataConflict&&<a data-metadata-reload href={withBasePath(`/generated/${generationId}`)}>Reload saved details</a>}
      </form>
    </>}
  </Container>;
}
