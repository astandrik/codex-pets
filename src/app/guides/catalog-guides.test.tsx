// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import McpGuide from "@/app/guides/codex-pets-mcp-integration-guide/page";
import OpenPetsGuide from "@/app/guides/codex-pets-vs-openpets/page";
import VsCodeGuide from "@/app/guides/codex-pets-vs-vscode-pets/page";
import { GET as mcpMarkdown } from "@/app/guides/codex-pets-mcp-integration-guide.md/route";
import { GET as openPetsMarkdown } from "@/app/guides/codex-pets-vs-openpets.md/route";
import { GET as vsCodeMarkdown } from "@/app/guides/codex-pets-vs-vscode-pets.md/route";
import { MCP_GUIDE_QUERY_EXAMPLES, METHODOLOGY_RUN_DATE as mcpRunDate } from "@/lib/guides/codex-pets-mcp-integration";
import { OPENPETS_QUERY_EXAMPLES, METHODOLOGY_RUN_DATE as openPetsRunDate } from "@/lib/guides/codex-pets-vs-openpets";
import { VS_VSCODE_PETS_QUERY_EXAMPLES, METHODOLOGY_RUN_DATE as vsCodeRunDate } from "@/lib/guides/codex-pets-vs-vscode-pets";
import { formatGuideDate, GUIDE_AUTHOR_NAME } from "@/lib/guides/shared";
import type { PublicPet } from "@/lib/pets/types";

const catalog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pets/repository", () => ({ listApprovedPetsForSearch: catalog }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => Promise<unknown>) => load }));

const pets: PublicPet[] = Array.from({ length: 6 }, (_, index) => ({
  id: `fixture-${index}`, slug: `fixture-${index}`, displayName: `Fixture pet ${index}`,
  description: `Synthetic catalog example ${index}`, spritesheetUrl: `/api/assets/fixture-${index}/spritesheet.webp`,
  petJsonUrl: `/api/assets/fixture-${index}/pet.json`, zipUrl: `/api/assets/fixture-${index}/pet.zip`,
  spritesheetExt: "webp", kind: "creature", tags: [], status: "approved", ownerName: "Synthetic author",
  ownerProfileSlug: "synthetic-author", ownerAvatarUrl: null, contactEmail: null,
  createdAt: "2026-05-01T00:00:00.000Z", approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: index, installCount: 0, likeCount: 0,
}));

beforeEach(() => {
  catalog.mockReset().mockResolvedValue(pets);
});

const guides = [
  { name: "MCP integration", page: McpGuide, markdown: mcpMarkdown, examples: MCP_GUIDE_QUERY_EXAMPLES, runDate: mcpRunDate, limit: 3 },
  { name: "OpenPets comparison", page: OpenPetsGuide, markdown: openPetsMarkdown, examples: OPENPETS_QUERY_EXAMPLES, runDate: openPetsRunDate, limit: 5 },
  { name: "VS Code Pets comparison", page: VsCodeGuide, markdown: vsCodeMarkdown, examples: VS_VSCODE_PETS_QUERY_EXAMPLES, runDate: vsCodeRunDate, limit: 5 },
];

describe.each(guides)("$name guide integration", ({ page, markdown, examples, runDate, limit }) => {
  it("renders the byline, dated methodology, decision table and actual response examples", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(await page());
    expect(container.querySelector(".guide-byline")?.textContent).toContain(GUIDE_AUTHOR_NAME);
    const methodology = Array.from(container.querySelectorAll("h2")).find((heading) => heading.textContent === "How we tested");
    expect(methodology?.nextElementSibling?.textContent).toContain(formatGuideDate(runDate));
    expect(container.querySelector("table")).not.toBeNull();
    const blocks = Array.from(container.querySelectorAll("pre code")).map((block) => block.textContent);
    for (const example of examples) {
      expect(blocks).toContain(example.command);
      expect(blocks).toContain(example.responseExcerpt);
    }
  });

  it("selects ranked examples from the complete approved snapshot", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(await page());
    expect(catalog).toHaveBeenCalledTimes(1);
    const links = Array.from(container.querySelectorAll('article a[href^="/pets/"]'));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      pets.toReversed().slice(0, limit).map((pet) => `/pets/${pet.slug}`),
    );
    expect(links[0].textContent).toBe("Fixture pet 5");
  });

  it("serves ranked markdown with the intended public cache policy", async () => {
    const response = await markdown();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain(GUIDE_AUTHOR_NAME);
    expect(body).toContain("How we tested");
    expect(body).toContain(formatGuideDate(runDate));
    expect(body).toContain("Fixture pet 5");
    expect(body).toContain("/pets/fixture-5");
    for (const example of examples) expect(body).toContain(example.responseExcerpt);
    expect(catalog).toHaveBeenCalledTimes(1);
  });
});

it("links the MCP guide primary CTA to GET-able markdown instead of the POST endpoint", async () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(await McpGuide());
  const header = container.querySelector(".page-section-header");
  expect(header?.querySelector('a[href="/mcp.md"]')?.textContent).toContain("MCP markdown");
  expect(header?.querySelector('a[href="/mcp"]')).toBeNull();
});
