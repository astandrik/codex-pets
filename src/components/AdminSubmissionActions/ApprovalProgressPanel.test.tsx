// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalProgressPanel } from "./ApprovalProgressPanel";
import type { ApprovalProgress } from "./useApprovalProgress";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); });
const progress = (phase: ApprovalProgress["phase"]): ApprovalProgress => ({ phase, startedAt: Date.now() - 180_000,
  checkedAt: Date.now(), connection: "connected", paused: false, snapshot: null });
describe("truthful approval status", () => {
  it.each([
    ["schema_invalid", "Inspect the saved response"],
    ["embedding_configuration_missing", "Check the server configuration"],
    ["stale_submission", "Refresh the page"],
  ])("retains actionable approval guidance for %s", (failureCode, message) => {
    const state = progress("manual_review");
    state.snapshot = { preparationId: "approval-1", status: "manual_review", attempts: 1,
      failureCode, nextAttemptAt: null, createdAt: null, updatedAt: null, leaseUntil: null };
    act(() => root.render(<ApprovalProgressPanel progress={state} />));
    expect(container.textContent).toContain(message);
    expect(container.textContent).toContain("Retry approval");
    expect(container.textContent).toContain("Check status only reads");
  });

  it("does not mistake a reachable API for a live worker", () => {
    act(() => root.render(<ApprovalProgressPanel progress={progress("queued")} />));
    expect(container.textContent).toContain("worker may be busy or unavailable");
    expect(container.textContent).toContain("Status checked"); expect(container.textContent).not.toContain("%");
  });
  it("distinguishes an expired processing lease from successful completion", () => {
    const state = progress("preparing"); state.snapshot = { preparationId: "approval-1", status: "preparing", attempts: 1,
      failureCode: null, nextAttemptAt: null, createdAt: null, updatedAt: new Date(Date.now() - 120_000).toISOString(), leaseUntil: new Date(Date.now() - 1).toISOString() };
    act(() => root.render(<ApprovalProgressPanel progress={state} />));
    expect(container.textContent).toContain("lease expired"); expect(container.textContent).toContain("Completion is not confirmed");
  });
  it("shows an explicit next-attempt time and transient network interruption", () => {
    const state = progress("retry"); state.connection = "lost"; state.snapshot = { preparationId: "approval-1", status: "retry", attempts: 1,
      failureCode: "provider_unavailable", nextAttemptAt: "2026-10-11T20:00:00Z", createdAt: null, updatedAt: null, leaseUntil: null };
    act(() => root.render(<ApprovalProgressPanel progress={state} />));
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-11T20:00:00Z");
    expect(container.textContent).toContain("Connection interrupted"); expect(container.textContent).toContain("no new approval");
  });
});
