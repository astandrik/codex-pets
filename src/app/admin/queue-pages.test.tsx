// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ principal: vi.fn(), submissions: vi.fn(), requests: vi.fn() }));
vi.mock("@/lib/auth/session", async original => ({
  ...await original<typeof import("@/lib/auth/session")>(),
  getCurrentPrincipal: mocks.principal,
}));
vi.mock("@/lib/pets/repository", () => ({ listPendingPets: mocks.submissions }));
vi.mock("@/lib/pets/generation-requests-repository", () => ({ listGenerationRequests: mocks.requests }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
}));


const submission = (index: number) => ({
  id: `pet-${index}`, slug: `pet-${index}`, displayName: `Queue pet ${index}`,
  description: "Fixture submission", kind: "creature", status: "pending",
  createdAt: "2026-01-01T00:00:00Z", ownerName: null, ownerProfileSlug: null,
  contactEmail: "private@example.test", publicEmailRequested: false,
});
const request = (index: number) => ({
  id: `req-${index}`, status: "pending", kind: "creature", displayNameHint: `Queue request ${index}`,
  prompt: "Fixture request", contactEmail: "private@example.test", requesterName: null,
  requesterProfileSlug: null, linkedPetSlug: null, referenceImage: null, adminNote: null,
  createdAt: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", (media: string) => ({
    media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  mocks.principal.mockResolvedValue({ role: "admin", userId: "admin" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each([
  { path: "/admin/submissions", load: () => import("./submissions/page"), list: mocks.submissions, fixture: submission },
  { path: "/admin/requests", load: () => import("./requests/page"), list: mocks.requests, fixture: request },
])("$path", ({ path, load, list, fixture }) => {
  async function render(page?: string) {
    vi.resetModules();
    const { default: Page } = await load();
    const { Providers } = await import("@/app/Providers");
    const tree = await Page({ searchParams: Promise.resolve(page === undefined ? {} : { page }) });
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<Providers>{tree}</Providers>);
    return container;
  }
  function response(page: number, totalItems = 201) {
    const start = (page - 1) * 50;
    list.mockResolvedValue({
      items: Array.from({ length: Math.max(0, Math.min(50, totalItems - start)) }, (_, i) => fixture(start + i)),
      pagination: { page, pageSize: 50, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 50)) },
    });
  }
  it("shows a full total and next link for more than 200 records", async () => {
    response(1);
    const dom = await render();
    expect(list).toHaveBeenCalledExactlyOnceWith(1);
    expect(dom.textContent).toContain("1–50 of 201");
    expect(dom.textContent).toContain("Page 1 of 5");
    expect(dom.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(dom.querySelector('a[rel="next"]')?.getAttribute("href")).toBe(`${path}?page=2`);
    expect(dom.querySelector('a[rel="prev"]')).toBeNull();
  }, 20_000);

  it("shows the 201st record on the last page and preserves base path links", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/gallery");
    response(5);
    const dom = await render("5");
    expect(list).toHaveBeenCalledExactlyOnceWith(5);
    expect(dom.textContent).toContain("201–201 of 201");
    expect(dom.textContent).toContain("Page 5 of 5");
    expect(dom.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(dom.textContent).toContain(path.endsWith("submissions") ? "Queue pet 200" : "Queue request 200");
    expect(dom.querySelector('a[rel="prev"]')?.getAttribute("href")).toBe(`/gallery${path}?page=4`);
    expect(dom.querySelector('a[rel="next"]')).toBeNull();
  });

  it("redirects a stale page to the current last page", async () => {
    response(4, 200);
    await expect(render("5")).rejects.toThrow(`REDIRECT:${path}?page=4`);
  });
  it.each(["0", "-1", "1.5", "no", "9007199254740992"])("rejects invalid page %s before loading the queue", async page => {
    await expect(render(page)).rejects.toThrow("NOT_FOUND");
    expect(list).not.toHaveBeenCalled();
  });
  it.each([null, { userId: "user", role: "user" }])("keeps the auth gate for %s", async principal => {
    mocks.principal.mockResolvedValue(principal);
    const dom = await render("2");
    expect(list).not.toHaveBeenCalled();
    expect(dom.textContent).toContain(principal ? "No admin access" : "Sign in required");
    expect(dom.textContent).not.toContain("private@example.test");
    expect(dom.querySelector('nav[aria-label="Queue pages"]')).toBeNull();
  });
  it("shows a zero count and an empty queue without pagination links", async () => {
    response(1, 0);
    const dom = await render();
    expect(dom.textContent).toContain("0");
    expect(dom.textContent).toContain("Inbox zero");
    expect(dom.querySelector('nav[aria-label="Queue pages"]')).toBeNull();
  });
});
