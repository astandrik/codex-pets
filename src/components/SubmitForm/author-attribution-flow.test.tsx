// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/metrics/yandex", () => ({ trackGoal: vi.fn() }));
vi.mock("@gravity-ui/uikit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@gravity-ui/uikit")>(),
  useToaster: () => ({ add: vi.fn() }),
}));

import { SubmitForm } from "@/components/SubmitForm/SubmitForm";
import { SubmissionsTable, type SubmissionRow } from "@/components/SubmissionsTable/SubmissionsTable";
import { ThemeProvider } from "@gravity-ui/uikit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as typeof window.matchMedia;
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let root: Root;
let container: HTMLDivElement;
let sprite: Buffer;
const fetchMock = vi.fn();
const jsonText = JSON.stringify({ id: "triage-only", displayName: "Triage", description: "Synthetic fixture",
  spriteVersionNumber: 2, spritesheetPath: "spritesheet.png" });

beforeAll(async () => {
  sprite = await sharp({ create: { width: 1536, height: 2288, channels: 4, background: { r: 50, g: 60, b: 70, alpha: 1 } } }).png().toBuffer();
});
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Image", class {
    width = 1536;
    height = 2288;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  URL.createObjectURL = () => "blob:triage-only";
  URL.revokeObjectURL = () => undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function setText(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>("#" + id)!;
  expect(input).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function render(children: React.ReactNode) {
  act(() => root.render(<ThemeProvider theme="light">{children}</ThemeProvider>));
}

async function uploadPackage() {
  const jsonFile = new File([jsonText], "pet.json", { type: "application/json" });
  // jsdom File lacks Blob.text(); adapt only that browser file API.
  Object.defineProperty(jsonFile, "text", { value: async () => jsonText });
  const spriteFile = new File([new Uint8Array(sprite)], "spritesheet.png", { type: "image/png" });
  for (const [id, file] of [["submit-petjson", jsonFile], ["submit-sprite", spriteFile]] as const) {
    const input = container.querySelector<HTMLInputElement>("#" + id)!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  expect(container.querySelector<HTMLTextAreaElement>("#submit-petjson-editor")?.value).toBe(jsonText);
}

async function submitAndCapture(): Promise<FormData> {
  const form = container.querySelector("form")!;
  expect(form.checkValidity()).toBe(true);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce(), { timeout: 2000, interval: 20 });
  });
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/submissions/register");
  expect(request.method).toBe("POST");
  expect(request.body).toBeInstanceOf(FormData);
  expect(request.body.get("zip")).toBeInstanceOf(File);
  return request.body;
}

describe("anonymous email and alias lifecycle", () => {
  for (const customized of [false, true]) {
    it("clearing email clears the " + (customized ? "custom" : "derived") + " alias in multipart", async () => {
      render(<SubmitForm isAuthenticated={false} />);
      await uploadPackage();
      setText("submit-email", "person@example.com");
      expect(container.querySelector<HTMLInputElement>("#submit-public-author-name")?.value).toBe("person");
      if (customized) setText("submit-public-author-name", "Custom alias");
      setText("submit-email", "");
      expect(container.querySelector("#submit-public-author-name")).toBeNull();
      const form = await submitAndCapture();
      expect(form.get("contactEmail")).toBe("");
      expect(form.get("publishContactEmail")).toBe("false");
      expect(form.get("publicAuthorName")).toBe("");
    });
  }
});

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return { id: "triage-only", slug: "triage-only", displayName: "Triage", description: "Synthetic fixture",
    kind: "creature", status: "pending", createdAt: "2026-08-27T08:00:00.000Z",
    ownerName: "Public alias", ownerProfileSlug: null, contactEmail: "private-triage@example.com",
    publicEmailRequested: false, ...overrides };
}

describe("moderator contact visibility", () => {
  it("shows private contact for a legacy anonymous row without ownerName", () => {
    render(<SubmissionsTable rows={[row({ ownerName: null })]} />);
    expect(container.textContent).toContain("private-triage@example.com");
  });

  it("keeps moderation contact visible with an alias and no publication request", async () => {
    render(<SubmissionsTable rows={[row()]} />);
    expect(container.textContent).toContain("Public alias");
    expect(container.textContent).not.toContain("Public email requested");
    const approve = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!;
    await act(async () => approve.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/submissions/triage-only/approve", expect.objectContaining({ body: JSON.stringify({ publishRequestedEmail: false }) }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("private-triage@example.com");
  });

  it("shows the requested address in the approval dialog", async () => {
    render(<SubmissionsTable rows={[row({ publicEmailRequested: true })]} />);
    expect(container.textContent).toContain("Public email requested");
    const approve = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!;
    await act(async () => approve.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("private-triage@example.com");
    expect(document.body.textContent).toContain("I verified ownership of this address; publish it");
  });
});
