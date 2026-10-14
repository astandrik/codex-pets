// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalPollUpdate, ApprovalSnapshot } from "./approval-preparation-client";

const mocks = vi.hoisted(() => ({ add: vi.fn(), poll: vi.fn(), refresh: vi.fn(), trackGoal: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/metrics/yandex", () => ({ trackGoal: mocks.trackGoal }));
vi.mock("./approval-preparation-client", async original => ({
  ...await original<typeof import("./approval-preparation-client")>(), pollApprovalPreparation: mocks.poll,
}));
vi.mock("@gravity-ui/icons", () => ({ Check: () => null, EllipsisVertical: () => null, TrashBin: () => null, Xmark: () => null }));
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  Dialog: Object.assign(() => null, { Header: () => null, Body: () => null, Footer: () => null }),
  DropdownMenu: () => null, Checkbox: () => null, Flex: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: () => null, TextArea: () => null, useToaster: () => ({ add: mocks.add }),
}));
import { AdminSubmissionActions } from "./AdminSubmissionActions";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
function snapshot(status: ApprovalSnapshot["status"]): ApprovalSnapshot {
  return { preparationId: "preparation-1", status, failureCode: null, attempts: status === "queued" ? 0 : 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: null, nextAttemptAt: null };
}
function clicked(label: string) { return Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!; }
async function render() { await act(async () => root.render(<AdminSubmissionActions petId="pet-1" publicEmailRequested={false} contactEmail={null} />)); }
function initialFetch() { return vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
  .mockResolvedValueOnce(Response.json({ preparationId: "preparation-1" }, { status: 202 })); }
const postCount = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([, init]) => init?.method === "POST").length;
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("visible approval lifecycle", () => {
  it("shows queued/preparing progress and ignores a double click before reporting success", async () => {
    const fetch = initialFetch(); vi.stubGlobal("fetch", fetch);
    let finish!: () => void; let update!: (u: ApprovalPollUpdate) => void;
    mocks.poll.mockImplementationOnce(async (_url, options) => {
      update = options.onUpdate; update({ connection: "connected", snapshot: snapshot("queued"), checkedAt: Date.now() });
      await new Promise<void>(resolve => { finish = resolve; }); return { status: "succeeded" };
    });
    await render();
    await act(async () => { const button = clicked("Approve"); button.click(); button.click(); });
    expect(postCount(fetch)).toBe(1); expect(container.textContent).toContain("Waiting for an approval worker");
    expect(mocks.trackGoal).not.toHaveBeenCalled();
    await act(async () => update({ connection: "connected", snapshot: snapshot("preparing"), checkedAt: Date.now() }));
    expect(container.textContent).toContain("Preparing metadata and search index");
    await act(async () => finish());
    expect(container.textContent).toContain("Pet approved"); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("codex-pets:approval:pet-1")).toBeNull();
  });
  it("shows manual review and never requeues it when checking status", async () => {
    const fetch = initialFetch().mockResolvedValue(Response.json({ ...snapshot("manual_review"), failureCode: "metadata_outcome_unknown" })); vi.stubGlobal("fetch", fetch);
    mocks.poll.mockResolvedValueOnce({ status: "manual_review", failureCode: "metadata_outcome_unknown" });
    await render(); await act(async () => clicked("Approve").click());
    expect(container.textContent).toContain("Approval needs attention"); expect(container.textContent).toContain("paid work");
    await act(async () => clicked("Check status").click());
    expect(postCount(fetch)).toBe(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.trackGoal).not.toHaveBeenCalled();
  });
  it("only an explicit Retry approval can requeue a stopped request", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...snapshot("manual_review"), failureCode: "metadata_schema_invalid" }))
      .mockResolvedValueOnce(Response.json({ ...snapshot("manual_review"), failureCode: "metadata_schema_invalid" }))
      .mockResolvedValueOnce(Response.json({ preparationId: "preparation-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetch); mocks.poll.mockResolvedValueOnce({ status: "succeeded" });
    await render(); await act(async () => clicked("Approve").click()); expect(postCount(fetch)).toBe(0);
    await act(async () => clicked("Retry approval").click()); expect(postCount(fetch)).toBe(1);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("pauses exhausted polling and resumes the same request by GET", async () => {
    const fetch = initialFetch().mockResolvedValue(Response.json(snapshot("queued"))); vi.stubGlobal("fetch", fetch);
    mocks.poll.mockResolvedValueOnce({ status: "timeout" }).mockResolvedValueOnce({ status: "succeeded" });
    await render(); await act(async () => clicked("Approve").click());
    expect(container.textContent).toContain("Status checks are paused");
    await act(async () => clicked("Check status").click());
    expect(postCount(fetch)).toBe(1); expect(mocks.poll).toHaveBeenCalledTimes(2); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("recovers a lost POST response by looking up existing work, never resending POST", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockRejectedValueOnce(new Error("lost ack"))
      .mockResolvedValue(Response.json(snapshot("preparing"))); vi.stubGlobal("fetch", fetch);
    mocks.poll.mockResolvedValueOnce({ status: "succeeded" });
    await render(); await act(async () => clicked("Approve").click());
    expect(container.textContent).toContain("Approval request was not confirmed");
    await act(async () => clicked("Check status").click());
    expect(fetch.mock.calls[2][0]).not.toContain("preparationId="); expect(postCount(fetch)).toBe(1); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("restores a receipt after page reload and only reads status", async () => {
    sessionStorage.setItem("codex-pets:approval:pet-1", JSON.stringify({ preparationId: "preparation-1", requestedAt: Date.now() - 30_000 }));
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot("preparing"))); vi.stubGlobal("fetch", fetch);
    mocks.poll.mockResolvedValueOnce({ status: "timeout" }); await render();
    expect(fetch.mock.calls[0][0]).toContain("preparationId=preparation-1"); expect(postCount(fetch)).toBe(0);
    expect(container.textContent).toContain("Preparing metadata and search index");
  });
  it("finds another tab's queued approval before attempting a new POST", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot("queued"))); vi.stubGlobal("fetch", fetch);
    mocks.poll.mockResolvedValueOnce({ status: "timeout" }); await render(); await act(async () => clicked("Approve").click());
    expect(postCount(fetch)).toBe(0); expect(container.textContent).toContain("Waiting for an approval worker");
  });
  it("keeps the receipt on auth/read failure and shows a persistent error", async () => {
    sessionStorage.setItem("codex-pets:approval:pet-1", JSON.stringify({ preparationId: "preparation-1", requestedAt: Date.now() }));
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 })); vi.stubGlobal("fetch", fetch); await render();
    expect(container.textContent).toContain("Cannot read approval status"); expect(container.textContent).toContain("admin sign-in");
    await act(async () => clicked("Check status").click()); expect(postCount(fetch)).toBe(0); expect(sessionStorage.getItem("codex-pets:approval:pet-1")).not.toBeNull();
  });
  it("aborts polling on unmount and ignores its late completion", async () => {
    const fetch = initialFetch(); vi.stubGlobal("fetch", fetch); let signal!: AbortSignal; let finish!: () => void;
    mocks.poll.mockImplementationOnce(async (_url, options) => { signal = options.signal; await new Promise<void>(r => { finish = r; }); return { status: "succeeded" }; });
    await render(); await act(async () => clicked("Approve").click());
    act(() => root.unmount()); root = createRoot(container);
    expect(signal.aborted).toBe(true); await act(async () => finish()); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
