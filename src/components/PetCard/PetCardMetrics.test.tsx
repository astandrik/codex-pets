// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metricsMocks = vi.hoisted(() => ({
  trackGoal: vi.fn(),
  add: vi.fn(),
}));

vi.mock("@/lib/metrics/yandex", () => metricsMocks);
vi.mock("@gravity-ui/uikit", () => ({
  useToaster: () => ({ add: metricsMocks.add }),
}));

import { PetCardMetrics } from "@/components/PetCard/PetCardMetrics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  metricsMocks.trackGoal.mockClear();
  metricsMocks.add.mockClear();
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderMetrics(related: boolean, layout: "default" | "home" = "default") {
  act(() =>
    root.render(
      <PetCardMetrics
        slug="star-fox"
        displayName="Star Fox"
        status="approved"
        likeCount={1}
        downloadCount={2}
        installCount={3}
        layout={layout}
        relatedContext={
          related
            ? {
                sourceSlug: "orbit-otter",
                targetSlug: "star-fox",
                position: 8,
              }
            : undefined
        }
      />,
    ),
  );
}

describe("PetCardMetrics download attribution", () => {
  it("adds direct related context", () => {
    renderMetrics(true);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[title="Download ZIP"]',
    );
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "card",
      source_slug: "orbit-otter",
      target_slug: "star-fox",
      position: 8,
      origin: "related_pet",
    });
  });

  it("keeps the ordinary card contract unchanged", () => {
    renderMetrics(false);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[title="Download ZIP"]',
    );
    link?.addEventListener("click", (event) => event.preventDefault());

    act(() => link?.click());

    expect(metricsMocks.trackGoal).toHaveBeenCalledWith("pet_download_click", {
      slug: "star-fox",
      surface: "card",
    });
  });
});

describe.each(["default", "home"] as const)("PetCardMetrics %s Like failures", (layout) => {
  it.each(["network", "invalid JSON"])("shows a safe error for %s and retries only after a click", async (failure) => {
    const request = vi.fn();
    if (failure === "network") request.mockRejectedValueOnce(new TypeError("PRIVATE_NETWORK_DETAIL"));
    else request.mockResolvedValueOnce(new Response("PRIVATE_INVALID_JSON"));
    vi.stubGlobal("fetch", request);
    renderMetrics(false, layout);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label^="Like Star Fox"]')!;

    await act(async () => button.click());

    expect(metricsMocks.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      theme: "danger", title: "Like failed",
      content: expect.any(String),
    }));
    expect(JSON.stringify(metricsMocks.add.mock.calls)).not.toContain("PRIVATE_");
    expect(button.disabled).toBe(false);
    expect(localStorage.getItem("codex-pets-liked:star-fox")).toBeNull();
    expect(metricsMocks.trackGoal).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);

    request.mockResolvedValueOnce(Response.json({ likeCount: 2 }));
    await act(async () => button.click());

    expect(request).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Liked Star Fox: 2 likes");
    expect(localStorage.getItem("codex-pets-liked:star-fox")).toBe("1");
  });

  it("preserves HTTP errors and prevents duplicate pending or completed likes", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", request);
    renderMetrics(false, layout);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label^="Like Star Fox"]')!;
    await act(async () => button.click());
    expect(metricsMocks.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "Status 500" }));
    expect(button.disabled).toBe(false);

    let finish!: (response: Response) => void;
    request.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => finish(Response.json({ likeCount: 2 })));
    await act(async () => button.click());
    expect(request).toHaveBeenCalledTimes(2);
  });
});
