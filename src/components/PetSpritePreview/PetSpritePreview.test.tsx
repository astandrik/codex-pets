// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PetSpritePreview } from "./PetSpritePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = {
  posterSlug: "boba",
  stripSrc: "/api/assets/boba/idle-strip.webp",
  alt: "Boba: a round companion",
  stripClassName: "test-strip",
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
const poster = () => host.querySelector<HTMLImageElement>("[data-pet-poster]");
const strip = () => host.querySelector<HTMLImageElement>(".test-strip");

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("serves a visible public poster in SSR without JavaScript", () => {
  host.innerHTML = renderToString(<PetSpritePreview {...props} />);
  expect(poster()?.getAttribute("src")).toBe("/pets/boba/preview.webp");
  expect(poster()?.alt).toBe(props.alt);
  expect(poster()?.getAttribute("loading")).toBe("lazy");
  expect(poster()?.style.visibility).toBe("");
  expect(strip()?.style.visibility).toBe("hidden");
});

it("keeps the poster for blocked strips and switches only after successful loading", () => {
  root = createRoot(host);
  act(() => root!.render(<PetSpritePreview {...props} eager />));
  act(() => strip()!.dispatchEvent(new Event("error")));
  expect(poster()?.style.visibility).toBe("");
  expect(poster()?.getAttribute("loading")).toBe("eager");
  act(() => strip()!.dispatchEvent(new Event("load")));
  expect(poster()?.style.visibility).toBe("hidden");
  expect(strip()?.style.visibility).toBe("");
  act(() => strip()!.dispatchEvent(new Event("error")));
  expect(poster()?.style.visibility).toBe("");
});

it("resets the visible poster when the selected pet changes", () => {
  root = createRoot(host);
  act(() => root!.render(<PetSpritePreview {...props} />));
  act(() => strip()!.dispatchEvent(new Event("load")));
  act(() => root!.render(<PetSpritePreview {...props} posterSlug="orbit" stripSrc="/api/assets/orbit/idle-strip.webp" />));
  expect(poster()?.getAttribute("src")).toBe("/pets/orbit/preview.webp");
  expect(poster()?.style.visibility).toBe("");
  expect(strip()?.style.visibility).toBe("hidden");
});

it.each([0, 1152])("handles strip completion before hydration (width %i)", async (width) => {
  host.innerHTML = renderToString(<PetSpritePreview {...props} />);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockImplementation(function (this: HTMLImageElement) {
    return this.className === "test-strip" ? width : 192;
  });
  await act(async () => { root = hydrateRoot(host, <PetSpritePreview {...props} />); });
  expect(poster()?.style.visibility).toBe(width ? "hidden" : "");
  expect(strip()?.style.visibility).toBe(width ? "" : "hidden");
});

it("keeps the poster when a strip cannot be derived", () => {
  host.innerHTML = renderToString(<PetSpritePreview {...props} stripSrc={null} />);
  expect(poster()?.getAttribute("src")).toBe("/pets/boba/preview.webp");
  expect(strip()).toBeNull();
});

it("preserves non-public strip previews without requesting public posters", () => {
  host.innerHTML = renderToString(<PetSpritePreview {...props} posterSlug={undefined} />);
  expect(poster()).toBeNull();
  expect(strip()?.getAttribute("src")).toBe(props.stripSrc);
  expect(strip()?.style.visibility).toBe("");
});

it("removes a failed poster without preventing the animation from loading", () => {
  root = createRoot(host);
  act(() => root!.render(<PetSpritePreview {...props} />));
  act(() => poster()!.dispatchEvent(new Event("error")));
  expect(poster()).toBeNull();
  act(() => strip()!.dispatchEvent(new Event("load")));
  expect(strip()?.style.visibility).toBe("");
});

it("uses the configured base path for the public poster", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/registry");
  const { PetSpritePreview: PreviewWithBasePath } = await import("./PetSpritePreview");
  host.innerHTML = renderToString(<PreviewWithBasePath {...props} />);
  expect(poster()?.getAttribute("src")).toBe("/registry/pets/boba/preview.webp");
});
