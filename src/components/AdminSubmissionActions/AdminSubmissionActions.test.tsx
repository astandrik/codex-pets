// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  poll: vi.fn(),
  refresh: vi.fn(),
  trackGoal: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/metrics/yandex", () => ({ trackGoal: mocks.trackGoal }));
vi.mock("./approval-preparation-client", () => ({
  pollApprovalPreparation: mocks.poll,
}));
vi.mock("@gravity-ui/icons", () => ({
  Check: () => null,
  EllipsisVertical: () => null,
  TrashBin: () => null,
  Xmark: () => null,
}));
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, onClick }: React.PropsWithChildren<{
    onClick?: () => void;
  }>) => <button onClick={onClick}>{children}</button>,
  Dialog: Object.assign(() => null, {
    Header: () => null,
    Body: () => null,
    Footer: () => null,
  }),
  DropdownMenu: () => null,
  Text: () => null,
  TextArea: () => null,
  useToaster: () => ({ add: mocks.add }),
}));

import { AdminSubmissionActions } from "./AdminSubmissionActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AdminSubmissionActions", () => {
  it("waits for a queued preparation before reporting approval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json(
        { status: "preparing", preparationId: "preparation-1" },
        { status: 202 },
      ),
    ));
    mocks.poll.mockResolvedValue("succeeded");

    await act(async () => {
      root.render(<AdminSubmissionActions petId="pet-1" />);
    });
    const approve = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Approve"));
    await act(async () => approve?.click());

    expect(mocks.poll).toHaveBeenCalledWith(
      "http://localhost:3000/api/admin/submissions/pet-1/approval-preparation?preparationId=preparation-1",
    );
    expect(mocks.trackGoal).toHaveBeenCalledWith("pet_review_approve");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not report success when preparation needs manual review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json(
        { status: "preparing", preparationId: "preparation-1" },
        { status: 202 },
      ),
    ));
    mocks.poll.mockResolvedValue("manual_review");

    await act(async () => {
      root.render(<AdminSubmissionActions petId="pet-1" />);
    });
    const approve = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Approve"));
    await act(async () => approve?.click());

    expect(mocks.trackGoal).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({
      theme: "danger",
      title: "Approval needs attention",
    }));
  });
});
