// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { GalleryFilter } from "@/components/GalleryFilter/GalleryFilter";

const DEBOUNCE_MS = 350;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Gravity UI components may touch these APIs; jsdom does not provide them.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

type RenderedFilter = {
  container: HTMLDivElement;
  root: Root;
  input: HTMLInputElement;
};

function renderFilter(
  props: Partial<Parameters<typeof GalleryFilter>[0]> = {},
): RenderedFilter {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const fullProps = {
    defaultQuery: "",
    defaultKind: "all" as const,
    defaultTags: [],
    suggestedTags: [],
    ...props,
  };
  act(() => {
    root.render(<GalleryFilter {...fullProps} />);
  });
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder="Search by name, tag, or vibe"]',
  );
  if (!input) throw new Error("search input not rendered");
  return { container, root, input };
}

function rerenderFilter(
  rendered: RenderedFilter,
  props: Partial<Parameters<typeof GalleryFilter>[0]>,
) {
  const fullProps = {
    defaultQuery: "",
    defaultKind: "all" as const,
    defaultTags: [],
    suggestedTags: [],
    ...props,
  };
  act(() => {
    rendered.root.render(<GalleryFilter {...fullProps} />);
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(input: HTMLInputElement, options: { composing?: boolean } = {}) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: options.composing ?? false,
      }),
    );
  });
}

function advancePastDebounce() {
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE_MS + 100);
  });
}

describe("GalleryFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    router.push.mockClear();
    router.replace.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("applies the query automatically after the debounce via replace", () => {
    const { input } = renderFilter();

    setInputValue(input, "cat");
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    advancePastDebounce();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/?q=cat", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Enter submits immediately via push and cancels the pending debounce", () => {
    const { input } = renderFilter();

    setInputValue(input, "neon");
    pressEnter(input);

    // The push must happen synchronously, before the debounce fires.
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/?q=neon", { scroll: false });

    advancePastDebounce();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Enter while IME composition is in progress", () => {
    const { input } = renderFilter();

    setInputValue(input, "cat");
    pressEnter(input, { composing: true });

    expect(router.push).not.toHaveBeenCalled();

    advancePastDebounce();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/?q=cat", { scroll: false });
  });

  it("reverting the input supersedes an in-flight debounced replace", () => {
    const { input } = renderFilter();

    setInputValue(input, "cat");
    advancePastDebounce();
    expect(router.replace).toHaveBeenCalledWith("/?q=cat", { scroll: false });

    // The navigation to ?q=cat is still in flight (server props have not
    // updated yet) when the user clears the box back to the applied URL.
    setInputValue(input, "");
    advancePastDebounce();

    // The latest intent must win over the already-started replace.
    expect(router.replace).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenLastCalledWith("/", { scroll: false });
  });

  it("keeps focus on the same input node when applied filters update from the server", () => {
    const rendered = renderFilter();
    const { input } = rendered;
    input.focus();

    setInputValue(input, "n");
    advancePastDebounce();
    expect(router.replace).toHaveBeenCalledWith("/?q=n", { scroll: false });

    // The navigation commits and HomePage re-renders with the applied
    // filters. The filter must not be remounted: the same input node keeps
    // focus so the user can continue typing.
    rerenderFilter(rendered, { defaultQuery: "n" });

    const currentInput = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by name, tag, or vibe"]',
    );
    expect(currentInput).toBe(input);
    expect(document.activeElement).toBe(input);

    setInputValue(input, "ne");
    advancePastDebounce();
    expect(router.replace).toHaveBeenLastCalledWith("/?q=ne", {
      scroll: false,
    });
  });
});
