// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPaginationItems,
  PetCatalog,
} from "@/components/PetCatalog/PetCatalog";
import type { PublicPetPayload } from "@/lib/pets/api-payloads";

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("@/components/PetCard/PetCard", () => ({
  PetCard: ({ pet }: { pet: PublicPetPayload }) => (
    <article data-pet-slug={pet.slug}>{pet.displayName}</article>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const intersectionObservers: TestIntersectionObserver[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.rootMargin = options.rootMargin ?? "0px";
    intersectionObservers.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(target: Element) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  observedTargets(): Element[] {
    return [...this.targets];
  }
}

describe("PetCatalog", () => {
  beforeEach(() => {
    intersectionObservers.length = 0;
    navigationMocks.refresh.mockReset();
    vi.stubGlobal(
      "IntersectionObserver",
      TestIntersectionObserver as unknown as typeof IntersectionObserver,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("creates compact page-number windows without hiding the endpoints", () => {
    expect(getPaginationItems(6, 2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(getPaginationItems(20, 10)).toEqual([
      1,
      "ellipsis-start",
      8,
      9,
      10,
      11,
      12,
      "ellipsis-end",
      20,
    ]);
  });

  it("server-renders real previous, numbered, and next links", () => {
    const html = renderToStaticMarkup(
      <PetCatalog
        initialPets={[createPet("page-two")]}
        initialPage={2}
        pageSize={24}
        totalItems={49}
        totalPages={3}
        snapshotVersion="snapshot-page-two"
        rankingVersion="ranking-page-two"
        filters={{ query: "", kind: "all", tags: [] }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    const nav = container.querySelector(
      'nav[aria-label="Pet catalog pages"]',
    );
    expect(nav?.querySelector('a[rel="prev"]')?.getAttribute("href")).toBe(
      "/",
    );
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("2");
    expect(nav?.querySelector('a[rel="next"]')?.getAttribute("href")).toBe(
      "/?page=3",
    );
  });

  it("appends the next page, deduplicates slugs, and replaces the visible URL", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({ nextJs: true }, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            total: 2,
            pets: [createPet("first"), createPet("second")],
            pagination: {
              page: 2,
              pageSize: 1,
              totalItems: 2,
              totalPages: 2,
              hasNextPage: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const rendered = renderCatalog();
    const loadObserver = intersectionObservers
      .filter((observer) => observer.rootMargin === "600px 0px")
      .at(-1);
    const sentinel = loadObserver?.observedTargets()[0];
    expect(sentinel).toBeDefined();

    await act(async () => {
      loadObserver?.trigger(sentinel!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      [...rendered.container.querySelectorAll("[data-pet-slug]")].map(
        (node) => node.getAttribute("data-pet-slug"),
      ),
    ).toEqual(["first", "second"]);

    const pageObserver = intersectionObservers
      .filter((observer) => observer.rootMargin !== "600px 0px")
      .at(-1);
    const pageTwo = pageObserver
      ?.observedTargets()
      .find((target) => target.getAttribute("data-catalog-page") === "2");
    expect(pageTwo).toBeDefined();

    act(() => {
      pageObserver?.trigger(pageTwo!);
    });

    expect(replaceState).toHaveBeenLastCalledWith(
      { nextJs: true },
      "",
      "/?page=2",
    );
    expect(
      rendered.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("Loaded 1 more pet");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/pets?page=2&pageSize=1",
      {
        headers: {
          Accept: "application/json",
          "X-Codex-Pets-Catalog-Snapshot": "snapshot-a",
          "X-Codex-Pets-Catalog-Ranking": "ranking-a",
        },
        signal: expect.any(AbortSignal),
      },
    );

    unmountCatalog(rendered);
  });

  it("refreshes instead of appending a page from another catalog snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "catalog_snapshot_changed",
            code: "catalog_snapshot_changed",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const rendered = renderCatalog();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[data-action="load-more"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
    expect(
      rendered.container.querySelector('[data-pet-slug="first"]'),
    ).not.toBeNull();
    expect(rendered.container.querySelector('[role="alert"]')).toBeNull();

    unmountCatalog(rendered);
  });

  it("limits automatic loading to one page while manual loading remains available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            pets: [createPet("second")],
            pagination: {
              page: 2,
              pageSize: 1,
              totalItems: 3,
              totalPages: 3,
              hasNextPage: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            pets: [createPet("third")],
            pagination: {
              page: 3,
              pageSize: 1,
              totalItems: 3,
              totalPages: 3,
              hasNextPage: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const rendered = renderCatalog({
      totalItems: 3,
      totalPages: 3,
    });
    const loadObserver = intersectionObservers
      .filter((observer) => observer.rootMargin === "600px 0px")
      .at(-1);
    const sentinel = loadObserver?.observedTargets()[0];
    expect(sentinel).toBeDefined();

    await act(async () => {
      loadObserver?.trigger(sentinel!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      intersectionObservers
        .filter((observer) => observer.rootMargin === "600px 0px")
        .flatMap((observer) => observer.observedTargets()),
    ).toHaveLength(0);
    expect(
      rendered.container.querySelector<HTMLButtonElement>(
        'button[data-action="load-more"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[data-action="load-more"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      rendered.container.querySelector('[data-pet-slug="third"]'),
    ).not.toBeNull();

    unmountCatalog(rendered);
  });

  it("keeps loaded cards and offers retry after a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const rendered = renderCatalog();
    const loadObserver = intersectionObservers
      .filter((observer) => observer.rootMargin === "600px 0px")
      .at(-1);
    const sentinel = loadObserver?.observedTargets()[0];

    await act(async () => {
      loadObserver?.trigger(sentinel!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      rendered.container.querySelectorAll("[data-pet-slug]"),
    ).toHaveLength(1);
    expect(
      rendered.container.querySelector<HTMLButtonElement>(
        'button[data-action="retry"]',
      ),
    ).not.toBeNull();

    unmountCatalog(rendered);
  });

  it("uses the Load more button and retries through the same page loader", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            pets: [createPet("second")],
            pagination: {
              page: 2,
              pageSize: 1,
              totalItems: 2,
              totalPages: 2,
              hasNextPage: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const rendered = renderCatalog();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[data-action="load-more"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[data-action="retry"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      rendered.container.querySelector('[data-pet-slug="second"]'),
    ).not.toBeNull();

    unmountCatalog(rendered);
  });

  it("aborts an in-flight page request when filters change", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const rendered = renderCatalog();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[data-action="load-more"]')
        ?.click();
      await Promise.resolve();
    });
    expect(requestSignal?.aborted).toBe(false);

    await act(async () => {
      rendered.rerender({
        filters: { query: "space", kind: "all", tags: [] },
      });
      await Promise.resolve();
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(
      rendered.container.querySelector('[data-pet-slug="first"]'),
    ).not.toBeNull();
    expect(rendered.container.querySelector('[role="alert"]')).toBeNull();

    unmountCatalog(rendered);
  });

  it("replaces loaded pages and totals when initial props change", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const rendered = renderCatalog();

    await act(async () => {
      rendered.rerender({
        initialPets: [createPet("replacement")],
        initialPage: 2,
        totalItems: 25,
        totalPages: 2,
        snapshotVersion: "snapshot-b",
        rankingVersion: "ranking-b",
      });
      await Promise.resolve();
    });

    expect(
      [...rendered.container.querySelectorAll("[data-pet-slug]")].map(
        (node) => node.getAttribute("data-pet-slug"),
      ),
    ).toEqual(["replacement"]);
    expect(
      rendered.container.querySelector('[data-catalog-page="2"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector('[aria-current="page"]')?.textContent,
    ).toBe("2");
    expect(rendered.container.textContent).toContain(
      "Reached the final catalog page. 1 of 25 matching pets shown.",
    );
    expect(rendered.container.textContent).not.toContain(
      "All 25 matching pets are loaded.",
    );

    unmountCatalog(rendered);
  });

  it("distinguishes an empty catalog from an empty filtered result", () => {
    const emptyCatalogHtml = renderToStaticMarkup(
      <PetCatalog
        initialPets={[]}
        initialPage={1}
        pageSize={24}
        totalItems={0}
        totalPages={0}
        snapshotVersion="snapshot-empty"
        rankingVersion="ranking-empty"
        filters={{ query: "", kind: "all", tags: [] }}
      />,
    );
    const emptyFilteredHtml = renderToStaticMarkup(
      <PetCatalog
        initialPets={[]}
        initialPage={1}
        pageSize={24}
        totalItems={0}
        totalPages={0}
        snapshotVersion="snapshot-filtered"
        rankingVersion="ranking-filtered"
        filters={{ query: "missing", kind: "all", tags: [] }}
      />,
    );

    expect(emptyCatalogHtml).toContain("No approved pets yet.");
    expect(emptyCatalogHtml).not.toContain("match these filters");
    expect(emptyFilteredHtml).toContain(
      "No approved pets match these filters.",
    );
  });
});

type PetCatalogProps = ComponentProps<typeof PetCatalog>;

function renderCatalog(overrides: Partial<PetCatalogProps> = {}): {
  container: HTMLDivElement;
  root: Root;
  rerender: (overrides: Partial<PetCatalogProps>) => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let props: PetCatalogProps = {
    initialPets: [createPet("first")],
    initialPage: 1,
    pageSize: 1,
    totalItems: 2,
    totalPages: 2,
    snapshotVersion: "snapshot-a",
    rankingVersion: "ranking-a",
    filters: { query: "", kind: "all", tags: [] },
    ...overrides,
  };
  const render = () => {
    act(() => {
      root.render(<PetCatalog {...props} />);
    });
  };
  render();

  return {
    container,
    root,
    rerender(overrides) {
      props = { ...props, ...overrides };
      render();
    },
  };
}

function unmountCatalog(rendered: { root: Root }) {
  act(() => {
    rendered.root.unmount();
  });
}

function createPet(slug: string): PublicPetPayload {
  return {
    id: `pet-${slug}`,
    slug,
    displayName: slug,
    description: "Public pet",
    spritesheetUrl: `/assets/${slug}.webp`,
    petJsonUrl: `/assets/${slug}.json`,
    zipUrl: `/assets/${slug}.zip`,
    spritesheetExt: "webp",
    kind: "creature",
    tags: ["space"],
    status: "approved",
    ownerName: "Creator",
    ownerProfileSlug: "creator",
    ownerProfileUrl: "/users/creator",
    ownerAvatarUrl: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
  };
}
