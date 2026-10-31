import {isValidElement, type ReactNode} from "react";
import {expect, it, vi} from "vitest";

const captured = vi.hoisted(() => ({element: null as ReactNode}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: ReactNode) { captured.element = element; }
  },
}));
vi.mock("@/lib/product-copy", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/product-copy")>();
  return {...actual, HOME_SEO: {...actual.HOME_SEO, ogTitle: "Updated shared social headline"}};
});

import {HOME_SEO} from "@/lib/product-copy";
import {renderSiteOgImage} from "./site-image";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as {children?: ReactNode}).children);
}

it("renders an updated headline from the shared product copy", () => {
  renderSiteOgImage();
  expect(textContent(captured.element)).toContain(HOME_SEO.ogTitle);
});
