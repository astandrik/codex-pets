// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PetDetailMoreActions } from "./PetDetailMoreActions";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), add: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@gravity-ui/uikit", async original => ({
  ...await original<typeof import("@gravity-ui/uikit")>(), useToaster: () => ({ add: navigation.add }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const props = { petId: "pet-a", slug: "boba", petJsonUrl: "/api/assets/a/pet.json", spritesheetUrl: "/api/assets/a/spritesheet.webp" };
const response = (admin = false, owner = false) => ({ ok: true, json: async () => ({ canAdminDelete: admin, canOwnerDelete: owner }) });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(e => e.textContent?.trim() === text)!;
const menuItem = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.trim() === text)!;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
async function render(next = props) { await act(async () => root.render(<ThemeProvider theme="dark"><PetDetailMoreActions {...next} /></ThemeProvider>)); }
async function openMenu() { await act(async () => button("More").click()); }

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset().mockResolvedValue(response()); vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("keeps file links accessible without delete permission or mutation", async () => {
  await render(); await openMenu();
  expect(document.querySelector('a[href="/api/assets/a/pet.json"]')?.getAttribute("target")).toBe("_blank");
  expect(document.querySelector('a[href="/api/assets/a/spritesheet.webp"]')).not.toBeNull();
  expect(menuItem("Delete…")).toBeUndefined();
  expect(posts()).toHaveLength(0);
});

it("retains the menu and links when permission loading fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline")); await render(); await openMenu();
  expect(menuItem("pet.json")).toBeDefined(); expect(menuItem("spritesheet")).toBeDefined();
  expect(menuItem("Delete…")).toBeUndefined(); expect(posts()).toHaveLength(0);
});

it("does not remount an open menu when permissions arrive", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); await openMenu(); const originalButton = button("More");
  await act(async () => resolve(response(true)));
  expect(button("More")).toBe(originalButton);
  expect(menuItem("pet.json")).toBeDefined(); expect(menuItem("Delete…")).toBeDefined();
  expect(posts()).toHaveLength(0);
});

it.each(["admin", "owner"])("requires explicit confirmation for %s deletion", async mode => {
  fetchMock.mockImplementation((_url, init) => init?.method === "POST" ? Promise.resolve({ ok: true }) : Promise.resolve(response(mode === "admin", mode === "owner")));
  await render(); await openMenu(); await act(async () => menuItem("Delete…").click());
  expect(document.querySelector('.g-modal_open')).not.toBeNull();
  expect(document.body.textContent).toContain("Delete this pet?"); expect(posts()).toHaveLength(0);
  await act(async () => button("Delete").click());
  expect(posts()).toHaveLength(1);
  expect(posts()[0][0]).toBe(mode === "admin" ? "/api/admin/submissions/pet-a/delete" : "/api/my-pets/pet-a/delete");
});

it.each([
  { mode: "owner", closeWith: "Cancel" },
  { mode: "owner", closeWith: "Escape" },
  { mode: "admin", closeWith: "Cancel" },
  { mode: "admin", closeWith: "Escape" },
])("closes $mode confirmation with $closeWith and restores focus and scrolling", async ({ mode, closeWith }) => {
  fetchMock.mockResolvedValue(response(mode === "admin", mode === "owner"));
  await render();
  const trigger = button("More");
  const initialOverflow = document.body.style.overflow;
  await openMenu();
  await act(async () => menuItem("Delete…").click());
  expect(document.querySelector(".g-modal_open")).not.toBeNull();
  await act(async () => {
    if (closeWith === "Cancel") button("Cancel").click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(posts()).toHaveLength(0);
  expect(document.querySelector(".g-modal_open")).toBeNull();
  expect(document.body.style.overflow).toBe(initialOverflow);
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("does not carry delete permission into a different pet", async () => {
  fetchMock.mockResolvedValueOnce(response(true)); await render();
  fetchMock.mockReturnValue(new Promise(() => {}));
  await render({ ...props, petId: "pet-b", slug: "other" }); await openMenu();
  expect(menuItem("Delete…")).toBeUndefined(); expect(posts()).toHaveLength(0);
});

it.each(["owner", "admin"])("does not reopen stale %s confirmation after A → B → A", async mode => {
  fetchMock.mockResolvedValue(response(mode === "admin", mode === "owner"));
  await render();
  await openMenu();
  await act(async () => menuItem("Delete…").click());
  expect(document.querySelector(".g-modal_open")).not.toBeNull();

  await render({ ...props, petId: "pet-b", slug: "other" });
  expect(document.querySelector(".g-modal_open")).toBeNull();
  await render(props);
  expect(posts()).toHaveLength(0);
  expect(document.querySelector(".g-modal_open")).toBeNull();

  const trigger = button("More");
  await openMenu();
  await act(async () => menuItem("Delete…").click());
  expect(document.querySelector(".g-modal_open")).not.toBeNull();
  await act(async () => button("Cancel").click());
  expect(document.querySelector(".g-modal_open")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(posts()).toHaveLength(0);
});
