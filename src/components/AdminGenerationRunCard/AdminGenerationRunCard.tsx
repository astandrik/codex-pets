"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Flex,
  Label,
  Select,
  Text,
  TextArea,
  TextInput,
  useToaster,
} from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import type { PetGenerationRun, PetGenerationReviewIssue } from "@/lib/pets/generation/types";
import type { GenerationRequestStatus, PetKind } from "@/lib/pets/types";
import "./AdminGenerationRunCard.scss";

const KIND_OPTIONS = [
  { value: "creature", content: "Creature" },
  { value: "character", content: "Character" },
  { value: "object", content: "Object" },
];
const ANIMATIONS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
const PROGRESS: Record<PetGenerationRun["status"], number> = {
  queued_base: 5, generating_base: 12, awaiting_base_review: 20, queued_hatch: 25,
  generating: 60, validating: 78, awaiting_final_review: 85, submitting: 90,
  awaiting_moderation: 95, completed: 100, failed: 0, cancelled: 0, submission_rejected: 0,
};

type MechanicalQa = { pass: boolean; issues: PetGenerationReviewIssue[] };

export function AdminGenerationRunCard({
  requestId,
  requestStatus,
  displayNameHint,
  prompt,
  kind: initialKind,
  run,
  generationEnabled,
}: {
  requestId: string;
  requestStatus: GenerationRequestStatus;
  displayNameHint: string | null;
  prompt: string;
  kind: PetKind;
  run: PetGenerationRun | null;
  generationEnabled: boolean;
}) {
  const router = useRouter();
  const { add } = useToaster();
  const [busy, setBusy] = useState(false);
  const [qa, setQa] = useState<MechanicalQa | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [petId, setPetId] = useState(run?.finalMetadata?.id ?? "");
  const [displayName, setDisplayName] = useState(run?.finalMetadata?.displayName ?? displayNameHint ?? "");
  const [description, setDescription] = useState(run?.finalMetadata?.description ?? prompt.slice(0, 320));
  const [kind, setKind] = useState<PetKind>(run?.finalMetadata?.kind ?? initialKind);
  const [tags, setTags] = useState(run?.finalMetadata?.tags.join(", ") ?? "");
  const artifact = (key: string) => withBasePath(`/api/admin/generation-runs/${run?.id}/artifacts/${key}`);
  const hasFinalArtifacts = Boolean(run && [
    "awaiting_final_review", "submitting", "awaiting_moderation", "completed", "submission_rejected",
  ].includes(run.status)) || run?.failureCode === "mechanical_qa_failed";

  useEffect(() => {
    if (!run || !hasFinalArtifacts) return;
    const controller = new AbortController();
    fetch(artifact("qa"), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => {
        if (value && typeof value.pass === "boolean" && Array.isArray(value.issues)) setQa(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [run?.id, hasFinalArtifacts]);

  useEffect(() => {
    if (!run || !["queued_base", "generating_base", "queued_hatch", "generating", "validating", "submitting"].includes(run.status)) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [router, run]);

  const canCreate = generationEnabled && ["pending", "in_progress"].includes(requestStatus) &&
    (!run || ["cancelled", "submission_rejected"].includes(run.status));
  const progress = run ? PROGRESS[run.status] : 0;
  const issues = useMemo(() => [...(qa?.issues ?? []), ...(run?.review?.issues ?? [])], [qa, run?.review]);

  async function call(action: string, url: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
    setBusy(true);
    try {
      const response = await fetch(withBasePath(url), {
        method: "POST",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        add({ name: `generation-${requestId}-${action}`, theme: "danger", title: `${action} failed`,
          content: payload?.message ?? `Status ${response.status}` });
        return;
      }
      add({ name: `generation-${requestId}-${action}`, theme: "success", title: action });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!run) return (
    <Card view="filled" className="admin-generation-run-card admin-generation-run-card_empty">
      <Flex alignItems="center" justifyContent="space-between" gap={2} wrap>
        <Text variant="caption-2" color="secondary">
          {generationEnabled ? "No automated run yet." : "Generator is disabled; manual actions remain available."}
        </Text>
        {canCreate ? <Button view="action" size="s" loading={busy} onClick={() => call(
          "Base generation queued",
          `/api/admin/generation-requests/${requestId}/runs`,
          undefined,
          { "Idempotency-Key": idempotencyKey },
        )}>Generate base</Button> : null}
      </Flex>
    </Card>
  );

  return (
    <Card view="filled" className="admin-generation-run-card">
      <Flex direction="column" gap={2}>
        <Flex alignItems="center" justifyContent="space-between" gap={2} wrap>
          <Flex alignItems="center" gap={2} wrap>
            <Text variant="subheader-1">Generation run</Text>
            <Label theme={run.status === "failed" || run.status === "submission_rejected" ? "danger" :
              run.status === "completed" ? "success" : "info"} size="s">{run.status.replaceAll("_", " ")}</Label>
          </Flex>
          <Text variant="caption-1" color="secondary">{run.imageCallCount}/15 image calls</Text>
        </Flex>
        <div
          className="admin-generation-run-card__progress"
          role="progressbar"
          aria-label={`${progress}% complete`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <Text variant="caption-1" color="secondary">
          Base revision {run.baseRevision + 1} · targeted retries {run.targetedRetryCount}/1 · {run.id}
        </Text>

        {["awaiting_base_review", "queued_hatch", "generating", "validating", "awaiting_final_review",
          "submitting", "awaiting_moderation", "completed", "failed", "submission_rejected"].includes(run.status) ? (
          <Flex direction="column" gap={1}>
            <Text variant="caption-2">Approved identity candidate</Text>
            <a href={artifact("base")} target="_blank" rel="noreferrer" className="admin-generation-run-card__preview-link">
              <span className="admin-generation-run-card__base" style={{ backgroundImage: `url("${artifact("base")}")` }} />
            </a>
          </Flex>
        ) : null}

        {run.failureCode ? (
          <Text variant="caption-2" color="danger">{run.failureCode}: {run.failureMessage}</Text>
        ) : null}
        {issues.length ? (
          <div className="admin-generation-run-card__issues">
            <Text variant="caption-2">Automatic review remarks</Text>
            <ul>
              {issues.map((issue, index) => <li key={`${issue.category}-${issue.row}-${issue.frame}-${index}`}>
                <strong>{issue.severity}</strong> · row {issue.row ?? "—"}, frame {issue.frame ?? "—"} · {issue.category}: {issue.message}
              </li>)}
            </ul>
          </div>
        ) : hasFinalArtifacts ? (
          <Text variant="caption-1" color="positive">Mechanical QA and model review reported no issues.</Text>
        ) : null}

        {hasFinalArtifacts ? (
          <Flex direction="column" gap={2}>
            <Flex gap={2} wrap>
              {["contact-sheet", "direction-sheet"].map((key) => (
                <a key={key} href={artifact(key)} target="_blank" rel="noreferrer" className="admin-generation-run-card__sheet-link">
                  <span style={{ backgroundImage: `url("${artifact(key)}")` }} />
                  <Text variant="caption-1">{key.replace("-", " ")}</Text>
                </a>
              ))}
            </Flex>
            <Flex gap={1} wrap className="admin-generation-run-card__animations">
              {ANIMATIONS.map((key) => <a key={key} href={artifact(`animation-${key}`)} target="_blank" rel="noreferrer"
                title={key} style={{ backgroundImage: `url("${artifact(`animation-${key}`)}")` }} />)}
            </Flex>
          </Flex>
        ) : null}

        <Flex gap={2} wrap>
          {run.status === "awaiting_base_review" ? <>
            <Button view="action" size="s" loading={busy} onClick={() => call("Base approved", `/api/admin/generation-runs/${run.id}/approve-base`)}>Approve base</Button>
            <Button view="outlined" size="s" loading={busy} disabled={run.baseRevision >= 1}
              onClick={() => call("Base regeneration queued", `/api/admin/generation-runs/${run.id}/regenerate-base`)}>Regenerate base</Button>
          </> : null}
          {run.status === "failed" ? <Button view="action" size="s" loading={busy} disabled={run.targetedRetryCount >= 1}
            onClick={() => call("Retry queued", `/api/admin/generation-runs/${run.id}/retry`)}>Retry failed stage</Button> : null}
          {["queued_base", "generating_base", "awaiting_base_review", "queued_hatch", "generating", "validating", "awaiting_final_review", "failed"].includes(run.status) ?
            <Button view="outlined-danger" size="s" loading={busy}
              onClick={() => call("Run cancelled", `/api/admin/generation-runs/${run.id}/cancel`)}>Cancel</Button> : null}
          {canCreate ? <Button view="action" size="s" loading={busy} onClick={() => call(
            "New base generation queued", `/api/admin/generation-requests/${requestId}/runs`, undefined,
            { "Idempotency-Key": idempotencyKey },
          )}>Generate new base</Button> : null}
        </Flex>

        {["awaiting_final_review", "submitting"].includes(run.status) ? (
          <form className="admin-generation-run-card__form" onSubmit={(event) => {
            event.preventDefault();
            void call("Pending pet created", `/api/admin/generation-runs/${run.id}/approve-final`, {
              id: petId, displayName, description, kind,
              tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            });
          }}>
            <Text variant="subheader-1">Final pending pet</Text>
            <TextInput value={petId} onUpdate={setPetId} placeholder="pet-id" size="m" aria-label="Pet id" />
            <TextInput value={displayName} onUpdate={setDisplayName} placeholder="Display name" size="m" aria-label="Display name" />
            <TextArea value={description} onUpdate={setDescription} placeholder="Description" minRows={3} maxRows={6} size="m" aria-label="Description" />
            <Select value={[kind]} onUpdate={(values) => setKind((values[0] ?? "creature") as PetKind)} options={KIND_OPTIONS} size="m" width="max" aria-label="Kind" />
            <TextArea value={tags} onUpdate={setTags} placeholder="tags, comma-separated" minRows={2} size="m" aria-label="Tags" />
            <Button type="submit" view="action" size="m" loading={busy} disabled={!petId.trim() || !displayName.trim() || !description.trim()}>Approve final</Button>
          </form>
        ) : null}
        {run.finalPetSlug ? <a href={withBasePath("/admin/submissions")} className="admin-generation-run-card__pet-link">
          Pending pet: {run.finalPetSlug}
        </a> : null}
      </Flex>
    </Card>
  );
}
