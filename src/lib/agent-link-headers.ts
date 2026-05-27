import { toPublicUrl } from "@/lib/base-path";
import {
  getMarkdownTwinPath,
  isMarkdownTwinSourcePath,
} from "@/lib/markdown-twins";

export function getAgentLinkHeaderForPath(pathname: string): string | null {
  const normalizedPath = normalizePathname(pathname);
  if (!shouldExposeAgentLinks(normalizedPath)) {
    return null;
  }

  return [
    `<${toPublicUrl("/sitemap.xml")}>; rel="sitemap"`,
    `<${toPublicUrl("/llms.txt")}>; rel="describedby"; type="text/plain"`,
    `<${toPublicUrl("/openapi.json")}>; rel="service-desc"; type="application/json"`,
    `<${toPublicUrl("/mcp")}>; rel="service"; type="application/json"`,
    ...getPathSpecificLinks(normalizedPath),
  ].join(", ");
}

export function appendAgentLinkHeaders(
  headers: Headers,
  pathname: string,
): void {
  const agentLinks = getAgentLinkHeaderForPath(pathname);
  if (!agentLinks) return;

  const current = headers.get("Link");
  headers.set("Link", current ? `${current}, ${agentLinks}` : agentLinks);
}

function shouldExposeAgentLinks(pathname: string): boolean {
  return isMarkdownTwinSourcePath(pathname) || pathname.startsWith("/guides/");
}

function getPathSpecificLinks(pathname: string): string[] {
  const links: string[] = [];
  const markdownPath = getMarkdownTwinPath(pathname);
  if (markdownPath) {
    links.push(
      `<${toPublicUrl(markdownPath)}>; rel="alternate"; type="text/markdown"`,
    );
  }

  if (pathname === "/developers") {
    links.push(
      `<${toPublicUrl("/developers/llms.txt")}>; rel="describedby"; type="text/plain"`,
    );
  }

  if (pathname === "/docs/api") {
    links.push(
      `<${toPublicUrl("/docs/llms.txt")}>; rel="describedby"; type="text/plain"`,
    );
  }

  return links;
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
