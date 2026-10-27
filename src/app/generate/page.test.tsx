import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@gravity-ui/uikit";
import { beforeEach, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({enabled: vi.fn(), review: vi.fn()}));
vi.mock("@/lib/pets/generation/model", () => ({generationEnabled: flags.enabled, generationReviewFlowEnabled: flags.review}));
import GeneratePage, {dynamic, metadata} from "./page";

beforeEach(() => vi.clearAllMocks());
it.each([[true, true], [true, false], [false, true], [false, false]])("renders the real form with flags %s, %s", (enabled, reviewBase) => {
  flags.enabled.mockReturnValue(enabled); flags.review.mockReturnValue(reviewBase);
  const html = renderToStaticMarkup(<ThemeProvider theme="dark"><GeneratePage /></ThemeProvider>);
  expect(html.match(/<h1/g)).toHaveLength(1);
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html).toContain(reviewBase ? "Create character" : "Generate pet");
  expect(html.includes('type="file"')).toBe(reviewBase);
  expect(html.toLowerCase()).toContain('maxlength="2000"');
  expect(html.toLowerCase()).toContain('maxlength="80"');
  expect(html).toContain('aria-required="true"');
  expect(html.includes("Generation is currently disabled.")).toBe(!enabled);
});
it("lets the form own page spacing without the generic page-shell padding", () => {
  flags.enabled.mockReturnValue(true); flags.review.mockReturnValue(true);
  const html = renderToStaticMarkup(<ThemeProvider theme="dark"><GeneratePage /></ThemeProvider>);
  expect(html).toContain('class="pet-generation-screen"');
  expect(html).not.toContain('page-shell');
});
it("keeps the route dynamic and private to search engines and referrers", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({index: false, follow: false, noarchive: true});
  expect(metadata.referrer).toBe("no-referrer");
});
