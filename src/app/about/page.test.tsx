// @vitest-environment jsdom
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import AboutPage, {metadata} from "./page";
import {ABOUT_COPY, ABOUT_SEO, PRODUCT_SUMMARY} from "@/lib/product-copy";
import {buildPageTitle} from "@/lib/site-metadata";
import {buildAboutMarkdown} from "@/lib/agent-markdown";
import {PAGE_VIEW_METADATA_NAME, parsePageViewMetadata} from "@/lib/metrics/page-view-metadata";

describe("About product metadata", () => {
  it("reports the displayed title in client-navigation analytics", () => {
    expect(metadata.title).toBe(ABOUT_SEO.title);
    const pageView = parsePageViewMetadata(String(metadata.other?.[PAGE_VIEW_METADATA_NAME] ?? ""));
    expect(pageView).toEqual({title: buildPageTitle(ABOUT_SEO.title), url: "/about"});
  });

  it("keeps the shared product description in HTML and Markdown", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<AboutPage/>);
    expect(ABOUT_COPY.lead).toBe(PRODUCT_SUMMARY);
    expect(container.querySelector(".about-hero__lead")?.textContent).toBe(PRODUCT_SUMMARY);
    expect(buildAboutMarkdown()).toContain(PRODUCT_SUMMARY);
  });
});
