"use client";
import {GenerationContinuation} from "./GenerationContinuation";
import {BaseGenerationRetry} from "./BaseGenerationRetry";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Container, TextInput } from "@gravity-ui/uikit";
import Image from "next/image";
import { GeneratedPetResult } from "./GeneratedPetResult";
import { toPublicUrl, withBasePath } from "@/lib/base-path";
import { parsePublicPetSlug, suggestPublicPetSlug } from "@/lib/pets/public-slug";
import type { PublicGeneration } from "@/lib/pets/generation/service";
import { publicGenerationError } from "@/lib/pets/generation/public-error";
import {GeneratedPetMetadataEditor} from "@/components/GeneratedPetMetadataEditor/GeneratedPetMetadataEditor";
import { notifyGenerationHistory, rememberGeneration } from "@/lib/pets/generation/history";
import {RefinementRecovery} from "./BaseRefinement";
import {AnimationRevisionEditor, AnimationRevisionCorrections} from "./AnimationRevisionEditor";
import {AnimationRevisionComparison} from "./AnimationRevisionComparison";
import {BaseReview} from "./BaseReview";
import "./GeneratedPetPreview.scss";
import {baseRepairProgressText} from "@/lib/pets/generation/base-repair-progress";
import {animationRepairProgressText} from "@/lib/pets/generation/animation-repair-progress";

const STATUS_LABELS = { queued: "Waiting in the queue", generating: "Creating your pet", awaiting_confirmation: "Your character is ready for review", processing: "Checking and packaging your pet", completed: "Your pet is ready", failed: "Generation could not be completed" };
type Submission = NonNullable<PublicGeneration["submission"]>;
type SlugCheck = { slug: string; status: "checking" | "available" | "error"; available?: boolean; suggestedSlug?: string; message?: string };

function readSubmission(value: unknown): Submission | null {
  if (!value || typeof value !== "object" || !("slug" in value) ||
      !("petId" in value) || typeof value.petId !== "string" || !("submittedAt" in value) || typeof value.submittedAt !== "string") return null;
  const slug = parsePublicPetSlug(value.slug);
  return slug ? { petId: value.petId, slug, submittedAt: value.submittedAt } : null;
}

export function GeneratedPetPreview({ generationId, previousGenerationId, animationHintsEnabled = false, animationRevisionsEnabled = false, continuationEnabled = false }: { generationId: string; previousGenerationId?: string; animationHintsEnabled?: boolean; animationRevisionsEnabled?: boolean; continuationEnabled?: boolean }) {
  return <GeneratedPetPreviewContent key={generationId} generationId={generationId} previousGenerationId={previousGenerationId} animationHintsEnabled={animationHintsEnabled} animationRevisionsEnabled={animationRevisionsEnabled} continuationEnabled={continuationEnabled} />;
}

function GeneratedPetPreviewContent({ generationId, previousGenerationId, animationHintsEnabled = false, animationRevisionsEnabled = false, continuationEnabled = false }: { generationId: string; previousGenerationId?: string; animationHintsEnabled?: boolean; animationRevisionsEnabled?: boolean; continuationEnabled?: boolean }) {
  const [differentAnimationPrompt, setDifferentAnimationPrompt] = useState(false);
  const [recoveryVisible,setRecoveryVisible]=useState(false);
  // Survive BaseReview unmount when status refresh observes another tab's confirmation.
  const animationPromptIntent = useRef<string | null>(null);
  const [previousUnavailable, setPreviousUnavailable] = useState(false);
  const [editingBase, setEditingBase] = useState(false);
  const files = withBasePath(`/api/pet-generations/${generationId}/files/`);
  const [generation, setGeneration] = useState<PublicGeneration | null>(null);
  const pendingAcceptance = Boolean(generation?.animationRevision && generation.animationRevision.acceptedAt === undefined);
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
  const observedStatus = useRef<PublicGeneration["status"] | undefined>(undefined);
  const submissionController = useRef<AbortController | null>(null);
  useEffect(() => () => submissionController.current?.abort(), []);
  useEffect(() => {
    if (generation?.status !== "failed" && generation?.status !== "awaiting_confirmation" && !(generation?.status === "completed" && pendingAcceptance)) return;
    const refresh = () => {if (!document.hidden) setRefreshVersion(value => value + 1);};
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);};
  }, [generation?.status, pendingAcceptance]);

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
        if (body.generation.baseConfirmed && animationPromptIntent.current !== null &&
            animationPromptIntent.current !== (body.generation.animationPrompt ?? "")) setDifferentAnimationPrompt(true);
        setGeneration(body.generation);
        setError(""); setUnavailable(false);
        rememberGeneration(generationId,body.generation.expiresAt);
        if (observedStatus.current !== body.generation.status) {
          observedStatus.current = body.generation.status;
          notifyGenerationHistory();
        }
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
    if (generation?.status !== "completed" || pendingAcceptance || unavailable || submission || !parsePublicPetSlug(slug)) {
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
  }, [generation?.status, pendingAcceptance, generationId, slug, submission, unavailable, checkAttempt, rememberSubmission]);

  function updateSlug(value: string) {
    if (savedSubmission.current || pendingSubmission.current) return;
    editedSlug.current = true;
    checkSequence.current++;
    setSlug(value); setSlugCheck(null); setSlugNotice(""); setSubmissionError("");
  }

  async function submitForReview() {
    if (pendingAcceptance || pendingSubmission.current || savedSubmission.current || metadataBlockedRef.current || metadataConflict || unavailable || generation?.status !== "completed" ||
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
  const showBaseReview = Boolean(generation && (generation.status === "awaiting_confirmation" || editingBase));
  const ready = Boolean(generation?.pet && generation.status === "completed" && !pendingAcceptance);
  const metadataEditor = generation?.status==="completed"&&!pendingAcceptance&&generation.metadata&&<GeneratedPetMetadataEditor generationId={generationId} metadata={generation.metadata} disabled={Boolean(submission)||submitting||unavailable} onBlocked={value=>{metadataBlockedRef.current=value;setMetadataBlocked(value);}} onSaved={metadata=>{setMetadataConflict(false);setGeneration(current=>current?{...current,metadata,pet:current.pet?{...current.pet,displayName:metadata.displayName??current.pet.displayName}:current.pet}:current);if(metadata.displayName&&!editedSlug.current&&!savedSubmission.current&&suggestPublicPetSlug(metadata.displayName)!==slug){checkSequence.current++;setSlug(suggestPublicPetSlug(metadata.displayName));setSlugCheck(null);setSlugNotice("");}}}/>;
  const animationEditor = <AnimationRevisionEditor generationId={generationId} metadataRevision={generation?.metadata?.revision ?? 0} canEdit={Boolean(animationRevisionsEnabled && generation?.canReviseAnimations && !unavailable)} blocked={metadataBlocked || metadataConflict || submitting}/>;
  const publicationForm = <form className="generated-pet-publication" onSubmit={(event) => { event.preventDefault(); void submitForReview(); }}>
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
      </form>;
  const generationDetails = <>
      {generation?.baseRetrySourceId && <p><a href={withBasePath(`/generated/${generation.baseRetrySourceId}`)}>Предыдущая попытка создания персонажа</a></p>}
    {generation?.baseConfirmed && (generation.animationPrompt || differentAnimationPrompt) && <section className="generated-pet-animation-hints" aria-label="Принятые пожелания"><h2>Пожелания к движениям</h2><p>{generation.animationPrompt || "Без дополнительных пожеланий."}</p></section>}
    {generation?.animationRevision && <AnimationRevisionCorrections corrections={generation.animationRevision.corrections} />}
    {generation?.continuation?.mode === "regenerate" && <p><a href={withBasePath(`/generated/${generation.continuation.sourceGenerationId}`)}>Исходное задание</a></p>}
    {generation?.animationRevision && <p><a href={withBasePath(`/generated/${generation.animationRevision.sourceGenerationId}`)}>Исходная версия анимаций</a></p>}
    {previousGenerationId && <p><a href={withBasePath(`/generated/${generationId}`)}>Open this version</a>{" · "}<a href={withBasePath(`/generated/${previousGenerationId}`)}>Open previous version</a></p>}
  </>;
  return <Container as="main" maxWidth={ready ? undefined : "xl"} gutters={recoveryVisible ? 2 : 5} className={ready ? "page-shell generated-pet-ready" : "page-shell"}>
    <a className={ready ? "generated-pet-ready__back" : undefined} href={withBasePath("/my-generations")}>{ready && <Image src={withBasePath("/assets/s09-arrow-left.svg")} alt="" width={16} height={16} unoptimized />}My generations</a>
    <div hidden={recoveryVisible} className={ready ? "generated-pet-ready__heading" : undefined}><h1>{generation?.pet?.displayName ?? "Generated pet"}</h1>{ready && <span className="generated-pet-ready__status" role="status">Ready</span>}</div>
    {ready && <p className="generated-pet-ready__intro">Preview your pet, then download its pack.</p>}
    {generation?.status==="processing"&&generation.metadata?.automaticState==="inflight"&&<p role="status">Preparing the name, description and tags…</p>}

    {!ready && metadataEditor}
    {(error || (!recoveryVisible && !ready)) && <p role="status" aria-live="polite">{error || baseRepairProgressText(generation?.baseRepair) || animationRepairProgressText(generation?.animationRepair) || (generation ? pendingAcceptance && generation.status === "completed" ? "Новая версия на проверке" : STATUS_LABELS[generation.status] : "Loading generation…")}</p>}
    {!ready && generation?.progress && generation.status !== "failed" && !baseRepairProgressText(generation.baseRepair) && !animationRepairProgressText(generation.animationRepair) && <p>{generation.progress.completedSteps} of {generation.progress.totalSteps} generation steps completed.</p>}
    {differentAnimationPrompt && <p role="status">Анимации уже подтверждены в другой вкладке с другими пожеланиями. Показан сохранённый вариант.</p>}
    {!ready && generation?.baseConfirmed && (generation.animationPrompt || differentAnimationPrompt) && <section className="generated-pet-animation-hints" aria-label="Принятые пожелания">
      <h2>Пожелания к движениям</h2><p>{generation.animationPrompt || "Без дополнительных пожеланий."}</p>
    </section>}
    {!showBaseReview && (unavailable || (generation && generation.status !== "awaiting_confirmation")) && <RefinementRecovery generationId={generationId} />}
    <GenerationContinuation onVisibilityChange={setRecoveryVisible} generationId={generationId} enabled={continuationEnabled && Boolean(generation?.canContinue)} onContinued={()=>{setRefreshVersion(v=>v+1);}}/>
    {!ready && generation?.continuation?.mode==="regenerate"&&<p><a href={withBasePath(`/generated/${generation.continuation.sourceGenerationId}`)}>Исходное задание</a></p>}
    {failed && !recoveryVisible && <div role="alert"><p>{failure.message}</p><p>{continuationEnabled && generation?.canContinue ? "Можно проверить сохранённые изображения и продолжить это задание." : failure.hint}</p></div>}
      <BaseGenerationRetry key={generationId} generationId={generationId} canRetry={Boolean(!unavailable && generation?.canRetryBase)}/>
      {!ready && generation?.baseRetrySourceId && <p><a href={withBasePath(`/generated/${generation.baseRetrySourceId}`)}>Предыдущая попытка создания персонажа</a></p>}
    {!ready && previousGenerationId && <p><a href={withBasePath(`/generated/${generationId}`)}>Open this version</a>{" · "}<a href={withBasePath(`/generated/${previousGenerationId}`)}>Open previous version</a></p>}
    <div className={previousGenerationId ? "generated-pet-versions" : undefined}>
      {previousGenerationId && <section className="generated-pet-base">
        <h2>Previous version</h2>
        {/* Private capability images bypass the optimizer and shared caches. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!previousUnavailable && <img src={withBasePath(`/api/pet-generations/${previousGenerationId}/base`)} alt="Previous character version" onError={() => setPreviousUnavailable(true)} />}
        <p>{previousUnavailable ? "The previous version is unavailable or has expired." : "The previous version keeps its original deadline."}</p>
      </section>}
      {generation && showBaseReview && <BaseReview generationId={generationId} expiresAt={generation.expiresAt} disabled={unavailable || generation.status !== "awaiting_confirmation"} onEditingChange={setEditingBase} animationHintsEnabled={animationHintsEnabled} onAnimationPromptIntent={prompt => {animationPromptIntent.current = prompt;}} onConfirmed={different => {if (different) setDifferentAnimationPrompt(true); setRefreshVersion(value => value + 1);}} />}
    </div>
    {!ready && generation?.animationRevision && <AnimationRevisionCorrections corrections={generation.animationRevision.corrections}/>}

    {animationRevisionsEnabled && generation?.status === "completed" && !pendingAcceptance && !generation.canReviseAnimations && <p lang="ru">Редактирование недоступно: у этой версии нет сохранённого базового образа.</p>}
    {generation?.pet && generation.status === "completed" && pendingAcceptance && generation.animationRevision && <AnimationRevisionComparison generationId={generationId} sourceGenerationId={generation.animationRevision.sourceGenerationId} expiresAt={generation.expiresAt} petJsonUrl={files + "pet.json"} spritesheetUrl={files + "spritesheet.webp"} beforeSpritesheetUrl={generation.animationRevision.beforeSpritesheetUrl} selectedStates={generation.animationRevision.selectedStates} unavailable={unavailable} onAccepted={() => setRefreshVersion(value => value + 1)}/>}
    <GeneratedPetResult ready={ready}
      petJsonUrl={files + "pet.json"} spritesheetUrl={files + "spritesheet.webp"}
      metadataEditor={ready ? metadataEditor : undefined} animationEditor={animationEditor} publicationForm={ready ? publicationForm : null}
        generationDetails={(generation?.animationPrompt || differentAnimationPrompt || generation?.animationRevision || generation?.continuation?.mode === "regenerate" || generation?.baseRetrySourceId || previousGenerationId) ? generationDetails : undefined}
      metadataBlocked={metadataBlocked} metadataConflict={metadataConflict} submitted={Boolean(submission)}
      downloads={generation && <>
        {!metadataBlocked ? <Button href={files + "pet.zip"} view="action" size="xl" width="max">Download ZIP</Button> : <p role="status">Save the name, description and tags to download your pet pack.</p>}
        {!metadataBlocked && <div className="generated-pet-result__files"><a href={files + "pet.json"}>pet.json</a><a href={files + "spritesheet.webp"}>Spritesheet</a></div>}
        <p>Download before {new Date(generation.expiresAt).toLocaleString()}.</p><p>Keep this link private.</p>
      </>}
    />
  </Container>;
}
