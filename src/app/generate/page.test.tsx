import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import GeneratePage, {dynamic, metadata} from "./page";

beforeEach(() => {
  vi.stubEnv("PET_GENERATION_ENABLED", "true");
  vi.stubEnv("PET_GENERATION_ENABLE_FILE", "");
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  vi.stubEnv("PET_GENERATION_ANIMATION_AUTO_REPAIR_ENABLED", "false");
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "30");
  vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "");
  vi.stubEnv("PET_GENERATION_DAILY_GLOBAL_LIMIT", "");
});
afterEach(() => vi.unstubAllEnvs());
it.each([true, false])("discloses automatic repairs according to the server flag %s alongside queue capacity", automaticAnimationRepair => {
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
  vi.stubEnv("PET_GENERATION_ANIMATION_AUTO_REPAIR_ENABLED", String(automaticAnimationRepair));
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "7");
  const page = GeneratePage();
  expect(page.props.children.props.automaticAnimationRepair).toBe(automaticAnimationRepair);
  expect(page.props.children.props.queueLimit).toBe(7);
  const html = renderToStaticMarkup(<ThemeProvider theme="dark">{page}</ThemeProvider>);
  expect(html.includes("up to 3 additional times")).toBe(automaticAnimationRepair);
});
it.each([[true, true], [true, false], [false, true], [false, false]])("renders the real form with flags %s, %s", (enabled, reviewBase) => {
  vi.stubEnv("PET_GENERATION_ENABLED", String(enabled)); vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", String(reviewBase));
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
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
  const html = renderToStaticMarkup(<ThemeProvider theme="dark"><GeneratePage /></ThemeProvider>);
  expect(html).toContain('class="pet-generation-screen"');
  expect(html).not.toContain('page-shell');
});
it("keeps the route dynamic and private to search engines and referrers", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({index: false, follow: false, noarchive: true});
  expect(metadata.referrer).toBe("no-referrer");
});

it("passes the resolved queue capacity from the server to the real form", () => {
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "7");
  expect(GeneratePage().props.children.props.queueLimit).toBe(7);
});

it("passes configured daily allowances from the server to the real form", () => {
  vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "12");
  vi.stubEnv("PET_GENERATION_DAILY_GLOBAL_LIMIT", "345");
  expect(GeneratePage().props.children.props.dailyQuotaLimits).toEqual({ip: 12, global: 345});
});

it("keeps the page and existing request recovery available when daily allowances are misconfigured", () => {
  vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "invalid-private-setting");
  const page = GeneratePage();
  expect(page.props.children.props.dailyQuotaLimits).toBeNull();
  const html = renderToStaticMarkup(<ThemeProvider theme="dark">{page}</ThemeProvider>);
  expect(html).toContain("Check existing request");
  expect(html).not.toContain("invalid-private-setting");
});

it.each([true, false])("keeps /generate available with invalid capacity and enabled=%s", enabled => {
  vi.stubEnv("PET_GENERATION_ENABLED", String(enabled));
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "invalid-private-setting");
  const page = GeneratePage();
  expect(page.props.children.props.queueLimit).toBeNull();
  const html = renderToStaticMarkup(<ThemeProvider theme="dark">{page}</ThemeProvider>);
  expect(html).toContain("<form");
  expect(html).toContain("New requests are temporarily unavailable");
  expect(html).not.toContain("invalid-private-setting");
  expect(html.includes("Generation is currently disabled.")).toBe(!enabled);
});
