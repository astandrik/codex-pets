"use client";

import { useEffect, useState } from "react";
import type { ApprovalProgress } from "./useApprovalProgress";

const COPY = {
  checking: ["Checking approval status", "Looking for an existing approval before sending a new request."],
  submitting: ["Sending approval request", "Waiting for the server to confirm that the request was accepted."],
  queued: ["Waiting for an approval worker", "The request is saved. The worker may be busy; do not approve this pet again."],
  preparing: ["Preparing metadata and search index", "The worker has claimed this request. It prepares annotations, image descriptions, embeddings and recommendations before publishing."],
  retry: ["Waiting for the next attempt", "The server scheduled another preparation attempt. You do not need to press Approve again."],
  manual_review: ["Approval needs attention", "Preparation stopped. Check the approval diagnostics before using Retry approval; it can restart paid preparation. Check status only reads the existing request."],
  succeeded: ["Pet approved", "Preparation finished and the pet was published."],
  unconfirmed: ["Approval request was not confirmed", "The response was lost. The request may have been accepted. Check its status; do not submit another approval."],
  unavailable: ["Cannot read approval status", "Check your connection and admin sign-in. A failed status check does not mean approval failed."],
} as const;
function approvalFailureMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "schema_invalid":
    case "malformed_json":
    case "metadata_schema_invalid":
    case "metadata_malformed_json":
      return "AI-generated search metadata failed validation. Inspect the saved response before using Retry approval.";
    case "embedding_configuration_missing":
    case "visual_configuration_missing":
    case "authentication_error":
      return "Search preparation is not configured correctly. Check the server configuration before using Retry approval.";
    case "stale_submission":
    case "stale_catalog":
      return "The submission or catalog changed during preparation. Refresh the page before using Retry approval.";
    default:
      return null;
  }
}
function age(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function ApprovalProgressPanel({ progress }: { progress: ApprovalProgress }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (["succeeded", "manual_review"].includes(progress.phase)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress.phase]);
  const [title, description] = COPY[progress.phase];
  const terminal = progress.phase === "succeeded" || progress.phase === "manual_review";
  const observedAt = terminal && progress.checkedAt !== null ? progress.checkedAt : now;
  const snapshot = progress.snapshot;
  const failureMessage = progress.phase === "manual_review" ? approvalFailureMessage(snapshot?.failureCode) : null;
  const expiredLease = progress.phase === "preparing" && snapshot?.leaseUntil && Date.parse(snapshot.leaseUntil) <= now;
  const updatedAt = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : null;
  const taskStartedAt = snapshot?.createdAt ? Date.parse(snapshot.createdAt) : progress.startedAt;
  const waitingLong = progress.phase === "queued" && now - taskStartedAt >= 60_000;
  const quietPreparation = progress.phase === "preparing" && updatedAt !== null && now - updatedAt >= 120_000;
  const attention = progress.phase === "manual_review" || progress.phase === "unconfirmed" || progress.phase === "unavailable" || expiredLease;
  return <section className="admin-actions__progress" aria-label="Approval progress">
    <p className="admin-actions__progress-title" role={attention ? "alert" : "status"} aria-live="polite">{title}</p>
    <p>{description}</p>
    {failureMessage && <p>{failureMessage}</p>}
    {progress.connection === "lost" && !progress.paused && <p role="status">Connection interrupted. Retrying status checks; no new approval is being sent.</p>}
    {expiredLease ? <p role="alert">The worker&apos;s processing lease expired. Completion is not confirmed; check the worker. This page will not restart approval.</p>
      : waitingLong ? <p>The request is still waiting. The worker may be busy or unavailable.</p>
      : quietPreparation ? <p>No recent stage change. Processing may still be running; the server does not report a live worker heartbeat.</p> : null}
    {progress.phase === "retry" && snapshot?.nextAttemptAt && <p>Next attempt: <time dateTime={snapshot.nextAttemptAt}>{new Date(snapshot.nextAttemptAt).toLocaleTimeString()}</time>.</p>}
    {progress.phase === "manual_review" && snapshot?.failureCode?.startsWith("metadata_") && <p>Saved metadata needs checking. Retrying could repeat paid work; inspect the saved response first.</p>}
    {snapshot?.failureCode && <p>Error: <code>{snapshot.failureCode}</code></p>}
    <p className="admin-actions__progress-time">Elapsed: {age(taskStartedAt, observedAt)}.
      {snapshot?.attempts != null && ` Attempts: ${snapshot.attempts}.`}
      {progress.checkedAt !== null && (terminal ? ` Status checked at ${new Date(progress.checkedAt).toLocaleString()}.` : ` Status checked ${age(progress.checkedAt, now)} ago.`)}
    </p>
    {progress.paused && <p>Status checks are paused. The server may still be processing. Use Check status to continue reading the same request.</p>}
  </section>;
}
