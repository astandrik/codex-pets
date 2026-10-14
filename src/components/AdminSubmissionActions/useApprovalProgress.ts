"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { parseApprovalSnapshot, pollApprovalPreparation, type ApprovalSnapshot, type ApprovalStatus } from "./approval-preparation-client";

export type ApprovalProgress = {
  phase: ApprovalStatus | "checking" | "submitting" | "unconfirmed" | "unavailable";
  startedAt: number;
  checkedAt: number | null;
  connection: "connecting" | "connected" | "lost";
  paused: boolean;
  snapshot: ApprovalSnapshot | null;
};
type Receipt = { preparationId: string | null; requestedAt: number };
const keyFor = (petId: string) => `codex-pets:approval:${petId}`;
function readReceipt(petId: string): Receipt | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(keyFor(petId)) ?? "null");
    if (!raw || typeof raw !== "object" || !("requestedAt" in raw) || typeof raw.requestedAt !== "number" ||
        !Number.isFinite(raw.requestedAt) || !("preparationId" in raw)) return null;
    if (raw.preparationId !== null && (typeof raw.preparationId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.preparationId))) return null;
    return { preparationId: raw.preparationId, requestedAt: raw.requestedAt };
  } catch { return null; }
}

export function useApprovalProgress(petId: string, onAccepted: () => void, onSucceeded: () => void) {
  const [progress, setProgress] = useState<ApprovalProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasRequest, setHasRequest] = useState(false);
  const active = useRef<AbortController | null>(null);
  const receipt = useRef<Receipt | null>(null);
  const callbacks = useRef({ onAccepted, onSucceeded });
  useEffect(() => { callbacks.current = { onAccepted, onSucceeded }; }, [onAccepted, onSucceeded]);

  const run = useCallback(async (allowNew: boolean, publishRequestedEmail = false, retryManual = false) => {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller;
    const stored = receipt.current ?? readReceipt(petId);
    const startedAt = stored?.requestedAt ?? Date.now();
    setBusy(true); setHasRequest(Boolean(stored));
    setProgress(old => ({ phase: old?.phase ?? "checking", snapshot: old?.snapshot ?? null,
      startedAt, checkedAt: old?.checkedAt ?? null, connection: "connecting", paused: false }));
    const remember = (preparationId: string | null) => {
      receipt.current = { preparationId, requestedAt: startedAt }; setHasRequest(true);
      try { sessionStorage.setItem(keyFor(petId), JSON.stringify(receipt.current)); } catch { /* In-memory receipt still prevents resubmission. */ }
    };
    const forget = () => {
      receipt.current = null; setHasRequest(false);
      try { sessionStorage.removeItem(keyFor(petId)); } catch { /* Storage may be disabled. */ }
    };
    const observe = (snapshot: ApprovalSnapshot, checkedAt: number) => {
      if (!current()) return;
      if (snapshot.preparationId) remember(snapshot.preparationId);
      setProgress({ phase: snapshot.status, snapshot, startedAt, checkedAt, connection: "connected", paused: false });
    };
    const readOrSubmit = async (url: string, init?: RequestInit) => {
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
        const payload: unknown = response.ok && (!init?.method || response.status === 202) ? await response.json() : null;
        return { response, payload };
      }
      finally { clearTimeout(timer); }
    };
    const statusURL = new URL(withBasePath(`/api/admin/submissions/${petId}/approval-preparation`), window.location.origin);
    if (stored?.preparationId) statusURL.searchParams.set("preparationId", stored.preparationId);
    try {
      // Check existing work before a new POST, including another tab's approval.
      const { response: initial, payload: initialPayload } = await readOrSubmit(statusURL.href);
      const initialSnapshot = initial.ok ? parseApprovalSnapshot(initialPayload) : null;
      if (!current()) return;
      if ((initial.status === 404 && allowNew && !stored) || (retryManual && initialSnapshot?.status === "manual_review")) {
        remember(null); // Persist uncertainty before sending a mutating request.
        setProgress(old => old && { ...old, phase: "submitting" });
        const { response, payload } = await readOrSubmit(withBasePath(`/api/admin/submissions/${petId}/approve`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publishRequestedEmail }),
        });
        if (!current()) return;
        if (!response.ok) {
          if ([400, 401, 403, 404, 422].includes(response.status)) forget();
          throw new Error("approval_not_confirmed");
        }
        if (response.status !== 202) {
          forget(); setProgress(old => old && { ...old, phase: "succeeded", connection: "connected" });
          callbacks.current.onSucceeded(); return;
        }
        if (!payload || typeof payload !== "object" || !("preparationId" in payload) || typeof payload.preparationId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.preparationId)) throw new Error("approval_not_confirmed");
        remember(payload.preparationId); statusURL.searchParams.set("preparationId", payload.preparationId);
        setProgress(old => old && { ...old, phase: "queued", connection: "connected" });
        callbacks.current.onAccepted();
      } else {
        if (!initial.ok) throw new Error("approval_status_unavailable");
        const snapshot = initialSnapshot;
        if (!snapshot?.preparationId) throw new Error("approval_status_unavailable");
        observe(snapshot, Date.now()); statusURL.searchParams.set("preparationId", snapshot.preparationId);
        callbacks.current.onAccepted();
        if (snapshot.status === "succeeded") { forget(); callbacks.current.onSucceeded(); return; }
        if (snapshot.status === "manual_review") return;
      }
      const result = await pollApprovalPreparation(statusURL.href, {
        signal: controller.signal,
        onUpdate: update => {
          if (!current()) return;
          if (update.connection === "connected") observe(update.snapshot, update.checkedAt);
          else setProgress(old => old && { ...old, connection: "lost" });
        },
      });
      if (!current() || result.status === "cancelled") return;
      if (result.status === "succeeded") { forget(); setProgress(old => old && { ...old, phase: "succeeded", connection: "connected" }); callbacks.current.onSucceeded(); }
      else if (result.status === "manual_review") setProgress(old => old && { ...old, phase: "manual_review", connection: "connected",
        snapshot: parseApprovalSnapshot({ ...old.snapshot, preparationId: receipt.current?.preparationId,
          status: "manual_review", failureCode: result.failureCode }) });
      else if (result.status === "timeout") setProgress(old => old && { ...old, paused: true });
      else if (result.status === "failed") setProgress(old => old && { ...old, phase: "unavailable", connection: "lost", paused: true });
    } catch {
      if (current()) setProgress(old => old && { ...old, phase: receipt.current?.preparationId ? "unavailable" : receipt.current ? "unconfirmed" : "unavailable", connection: "lost", paused: true });
    } finally {
      if (current()) { active.current = null; setBusy(false); }
    }
  }, [petId]);

  useEffect(() => {
    receipt.current = readReceipt(petId);
    if (receipt.current) void run(false);
    return () => { active.current?.abort(); active.current = null; };
  }, [petId, run]);

  return { progress, busy, hasRequest, approve: (publishEmail = false) => run(true, publishEmail), resume: () => run(false), retry: (publishEmail = false) => run(true, publishEmail, true) };
}
