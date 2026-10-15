// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm/AuthForm";
import { ProfileForm } from "./ProfileForm/ProfileForm";
import { PetRequestForm } from "./PetRequestForm/PetRequestForm";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/metrics/yandex", () => ({ trackGoal: vi.fn() }));
vi.mock("@gravity-ui/uikit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@gravity-ui/uikit")>(),
  useToaster: () => ({ add: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

let element: HTMLDivElement, root: Root;
const request = vi.fn<typeof fetch>();
const profile = {
  email: "owner@example.com", displayName: "Owner", profileSlug: "owner",
  bio: null, websiteUrl: null, githubUrl: null, linkedinUrl: null, avatarUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks(); request.mockReset(); vi.stubGlobal("fetch", request);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:test-image"; }
    static revokeObjectURL() {}
  });
  element = document.createElement("div"); document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(<ThemeProvider theme="light">{node}</ThemeProvider>));
}
function field(id: string) {
  const value = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!value) throw new Error(`Missing field ${id}`);
  return value;
}
function edit(id: string, value: string) {
  const input = field(id);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function chooseFile(id: string) {
  const input = field(id);
  const file = new File(["synthetic image"], "pet.png", { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  return file;
}
async function submit() {
  await act(async () => element.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
function expectUnlocked() { expect(element.querySelector("fieldset")?.disabled).toBe(false); }

const failures = [
  { name: "JSON error", response: () => Response.json({ error: "Save denied" }, { status: 409 }), message: "Save denied" },
  { name: "non-JSON HTTP error", response: () => new Response("gateway", { status: 502 }), message: "Request failed" },
  { name: "network error", response: () => Promise.reject(new Error("Network failed")), message: "Network failed" },
];

describe.each(["login", "register"] as const)("%s form response lifecycle", (mode) => {
  async function filled() {
    await render(<AuthForm mode={mode} />);
    edit("auth-email", "user@example.com"); edit("auth-password", "synthetic-password");
    if (mode === "register") edit("auth-display-name", "Creator");
  }
  it("waits for the response, then navigates and unlocks", async () => {
    let finish!: (response: Response) => void;
    request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await filled(); await submit();
    expect(element.querySelector("fieldset")?.disabled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    expect(request.mock.calls[0][0]).toBe(`/api/auth/${mode}`);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      email: "user@example.com", password: "synthetic-password", displayName: mode === "register" ? "Creator" : "",
    });
    await act(async () => finish(Response.json({ ok: true })));
    expect(router.push).toHaveBeenCalledWith("/my-pets"); expect(router.refresh).toHaveBeenCalledOnce(); expectUnlocked();
  });
  it.each(failures)("retains input and unlocks after $name", async ({ response, message }) => {
    request.mockImplementation(async () => response()); await filled(); await submit();
    expect(element.textContent).toContain(message); expect(field("auth-email").value).toBe("user@example.com");
    expect(field("auth-password").value).toBe("synthetic-password"); expect(router.push).not.toHaveBeenCalled(); expectUnlocked();
  });
});

describe("profile and request form response lifecycle", () => {
  it.each([false, true])("saves profile with image=%s and applies normalized server values", async (withImage) => {
    request.mockResolvedValue(Response.json({ ok: true, profile: { ...profile, displayName: "Normalized owner", avatarUrl: "/api/avatar/new" } }));
    await render(<ProfileForm {...profile} />); edit("profile-display-name", "Draft owner");
    if (withImage) chooseFile("profile-avatar"); await submit();
    const [url, init] = request.mock.calls[0]; expect(url).toBe("/api/auth/profile"); expect(init?.method).toBe("PATCH");
    if (withImage) {
      expect(init?.body).toBeInstanceOf(FormData); const body = init?.body as FormData;
      expect(body.get("displayName")).toBe("Draft owner"); expect((body.get("avatar") as File).name).toBe("pet.png");
    } else expect(JSON.parse(String(init?.body)).displayName).toBe("Draft owner");
    expect(field("profile-display-name").value).toBe("Normalized owner");
    expect(element.querySelector('img[src="/api/avatar/new"]')).not.toBeNull();
    expect(router.refresh).toHaveBeenCalledOnce(); expectUnlocked();
  });
  it.each([false, true])("submits request with image=%s, clears brief and preserves contact", async (withImage) => {
    request.mockResolvedValue(Response.json({ ok: true }));
    await render(<PetRequestForm defaultContactEmail="owner@example.com" defaultRequesterName="Owner" />);
    edit("request-display-name", "Fox"); edit("request-prompt", "A curious fox");
    if (withImage) chooseFile("request-reference-image"); await submit();
    const [url, init] = request.mock.calls[0]; expect(url).toBe("/api/generation-requests");
    if (withImage) {
      const body = init?.body as FormData; expect(body).toBeInstanceOf(FormData);
      expect(body.get("prompt")).toBe("A curious fox"); expect((body.get("referenceImage") as File).name).toBe("pet.png");
    } else expect(JSON.parse(String(init?.body)).prompt).toBe("A curious fox");
    expect(field("request-prompt").value).toBe(""); expect(field("request-display-name").value).toBe("");
    expect(field("request-email").value).toBe("owner@example.com"); expect(field("request-name").value).toBe("Owner");
    expect(element.textContent).toContain("Request received"); expectUnlocked();
  });
  it.each(failures)("preserves profile draft and upload after $name", async ({ response, message }) => {
    request.mockImplementation(async () => response()); await render(<ProfileForm {...profile} />);
    edit("profile-display-name", "Draft owner"); chooseFile("profile-avatar"); await submit();
    expect(element.textContent).toContain(message); expect(field("profile-display-name").value).toBe("Draft owner");
    expect(element.querySelector('img[src="blob:test-image"]')).not.toBeNull(); expect(router.refresh).not.toHaveBeenCalled(); expectUnlocked();
  });
  it.each(failures)("preserves request draft and upload after $name", async ({ response, message }) => {
    request.mockImplementation(async () => response()); await render(<PetRequestForm defaultContactEmail="owner@example.com" />);
    edit("request-prompt", "A curious fox"); chooseFile("request-reference-image"); await submit();
    expect(element.textContent).toContain(message); expect(field("request-prompt").value).toBe("A curious fox");
    expect(element.querySelector<HTMLElement>(".pet-request-form__reference-image")?.style.backgroundImage).toContain("blob:test-image"); expectUnlocked();
  });
});
