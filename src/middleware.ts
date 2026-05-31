import { NextResponse, type NextRequest } from "next/server";

import { BASE_PATH } from "@/lib/base-path";
import { appendAgentLinkHeaders } from "@/lib/agent-link-headers";
import {
  getMarkdownTwinPath,
  isMarkdownTwinSourcePath,
} from "@/lib/markdown-twins";
import { getPreviewRewritePath } from "@/lib/preview/request";

export function middleware(request: NextRequest): Response {
  const basePath = request.nextUrl.basePath || BASE_PATH || undefined;
  const pathname = stripBasePath(request.nextUrl.pathname, basePath);
  const oauthMetadataPath = getOAuthProtectedResourceRewritePath(pathname, basePath);
  if (oauthMetadataPath) {
    const rewriteUrl = new URL(request.url);
    rewriteUrl.pathname = withBasePath(oauthMetadataPath, basePath);
    return NextResponse.rewrite(rewriteUrl);
  }

  const markdownPath = getMarkdownRewritePath(request, pathname);
  if (markdownPath) {
    const rewriteUrl = new URL(request.url);
    rewriteUrl.pathname = withBasePath(markdownPath, basePath);
    const response = NextResponse.rewrite(rewriteUrl);
    appendVary(response.headers, "Accept");
    appendAgentLinkHeaders(response.headers, pathname);
    return response;
  }

  const rewritePath = getPreviewRewritePath({
    method: request.method,
    pathname: request.nextUrl.pathname,
    basePath,
    headers: request.headers,
  });

  if (!rewritePath) {
    const response = NextResponse.next();
    appendVaryForMarkdownNegotiation(response.headers, pathname);
    appendAgentLinkHeaders(response.headers, pathname);
    return response;
  }

  const rewriteUrl = new URL(request.url);
  rewriteUrl.pathname = withBasePath(rewritePath, basePath);

  const response = NextResponse.rewrite(rewriteUrl);
  appendVaryForMarkdownNegotiation(response.headers, pathname);
  appendAgentLinkHeaders(response.headers, pathname);
  return response;
}

function getMarkdownRewritePath(
  request: NextRequest,
  pathname: string,
): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  if (!prefersMarkdown(request.headers.get("accept"))) {
    return null;
  }

  return getMarkdownTwinPath(pathname);
}

function getOAuthProtectedResourceRewritePath(
  pathname: string,
  basePath?: string,
): string | null {
  if (!basePath) return null;

  const wellKnownPath = "/.well-known/oauth-protected-resource";
  const derivedBasePath = `${wellKnownPath}${basePath}`;
  if (pathname === derivedBasePath || pathname === `${derivedBasePath}/`) {
    return wellKnownPath;
  }

  if (pathname === `${derivedBasePath}/mcp` || pathname === `${derivedBasePath}/mcp/`) {
    return `${wellKnownPath}/mcp`;
  }

  return null;
}

function appendVaryForMarkdownNegotiation(
  headers: Headers,
  pathname: string,
): void {
  if (isMarkdownNegotiablePath(pathname)) {
    appendVary(headers, "Accept");
  }
}

function isMarkdownNegotiablePath(pathname: string): boolean {
  return isMarkdownTwinSourcePath(pathname);
}

function prefersMarkdown(acceptHeader: string | null): boolean {
  const markdown = getAcceptedMediaQuality(acceptHeader, "text/markdown");
  if (markdown <= 0) {
    return false;
  }

  const html = getAcceptedMediaQuality(acceptHeader, "text/html");
  return markdown > html;
}

function getAcceptedMediaQuality(
  acceptHeader: string | null,
  mediaType: string,
): number {
  if (!acceptHeader) {
    return 0;
  }

  let bestQuality = 0;
  for (const range of acceptHeader.split(",")) {
    const [rawType, ...rawParameters] = range.split(";");
    const type = rawType?.trim().toLowerCase();
    if (!type || !mediaRangeMatches(type, mediaType)) {
      continue;
    }

    const quality = rawParameters.reduce((currentQuality, parameter) => {
      const [rawName, rawValue] = parameter.split("=");
      if (rawName?.trim().toLowerCase() !== "q") {
        return currentQuality;
      }

      const parsed = Number.parseFloat(rawValue?.trim() ?? "");
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
    }, 1);
    bestQuality = Math.max(bestQuality, quality);
  }

  return bestQuality;
}

function mediaRangeMatches(range: string, mediaType: string): boolean {
  if (range === mediaType || range === "*/*") {
    return true;
  }

  const [rangeType, rangeSubtype] = range.split("/");
  const [mediaTypeType] = mediaType.split("/");
  return rangeSubtype === "*" && rangeType === mediaTypeType;
}

function stripBasePath(pathname: string, basePath?: string): string {
  if (!basePath || pathname === basePath) {
    return pathname === basePath ? "/" : pathname;
  }

  return pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length) || "/"
    : pathname;
}

function withBasePath(pathname: string, basePath?: string): string {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
    return pathname;
  }

  return pathname === "/" ? basePath : `${basePath}${pathname}`;
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const normalizedValue = value.toLowerCase();
  const values = current
    .split(",")
    .map((item) => item.trim().toLowerCase());
  if (!values.includes(normalizedValue)) {
    headers.set("Vary", `${current}, ${value}`);
  }
}
