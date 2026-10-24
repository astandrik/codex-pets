// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppHeaderNav } from "./AppHeaderNav";
const route = vi.hoisted(() => ({ pathname: "/generate", basePath: "" }));
vi.mock("@/lib/base-path", () => ({ withBasePath: (path: string) => route.basePath + path }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
let root: Root, element: HTMLDivElement;
const fetchMock = vi.fn();
const principal = { userId: "demo", name: "Demo", email: null, profileSlug: "demo", role: "user" };
beforeEach(() => { route.pathname = "/generate"; route.basePath = ""; element = document.createElement("div"); document.body.append(element); root = createRoot(element); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function render(role: "guest" | "user" | "admin", profileSlug: string | null = "demo") {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ principal: role === "guest" ? null : { ...principal, role, profileSlug }, pendingReviewCount: 3, openRequestCount: 2 }) });
  await act(async () => root.render(<ThemeProvider theme="light"><AppHeaderNav /></ThemeProvider>));
}
const trigger = () => element.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const menu = () => document.querySelector('[role="dialog"][aria-label="Menu"]')!;
it.each(["guest", "user", "admin"] as const)("preserves links and role gates for %s without fetching on open", async role => {
  await render(role); expect(trigger()).not.toBeNull();
  await act(async () => trigger().click());
  const hrefs = [...menu().querySelectorAll("a")].map(link => link.getAttribute("href"));
  expect(hrefs).toEqual(expect.arrayContaining(["/", "/about", "/agents", "/developers", "/generate", "/request", "/submit", "/my-generations", "/docs/api", "/openapi.json", "/llms-full.txt", "/api/manifest"]));
  expect(menu().querySelectorAll('a[href^="/guides/"]')).toHaveLength(6);
  expect(hrefs.includes("/login")).toBe(role === "guest"); expect(hrefs.includes("/logout")).toBe(role !== "guest");
  expect(hrefs.includes("/admin/generation-limits")).toBe(role === "admin");
  if (role === "admin") { expect(menu().querySelector('a[href="/admin/submissions"]')?.textContent).toContain("3"); expect(trigger().textContent).toContain("5"); }
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(menu().querySelector('a[href="/generate"]')?.getAttribute("aria-current")).toBe("page");
});
it("uses the profile settings fallback, base path and closes after route changes", async () => {
  route.basePath = "/pets-app";
  await render("user", null); await act(async () => trigger().click());
  expect(menu().querySelector('a[href="/profile"]')).not.toBeNull();
  expect(menu().querySelector('a[href="/pets-app/logout"]')).not.toBeNull();
  expect(fetchMock.mock.calls[0][0]).toBe("/pets-app/api/auth/nav");
  route.pathname = "/about"; await render("user", null);
  expect(trigger().getAttribute("aria-expanded")).toBe("false"); expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("closes with Escape and keeps public links available after a navigation read failure", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  await act(async () => root.render(<ThemeProvider theme="light"><AppHeaderNav /></ThemeProvider>));
  await act(async () => { trigger().focus(); trigger().click(); });
  expect(menu().querySelector('a[href="/generate"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
