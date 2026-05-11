type HeaderReader = Pick<Headers, "get">;

type PreviewRequestContext = {
  method: string;
  pathname: string;
  basePath?: string;
  headers: HeaderReader;
};

const PREVIEW_USER_AGENT_RE =
  /TelegramBot|WebpageBot|Twitterbot|Slackbot|LinkedInBot|facebookexternalhit|Discordbot|WhatsApp|SkypeUriPreview/i;

const TELEGRAM_BROWSERISH_USER_AGENT_RE =
  /Firefox\/(?:75|77)\.0|Chrome\/(?:72|96)\.0\./i;

const TELEGRAM_PREVIEW_IP_PREFIXES = [
  "149.154.161.",
  "95.161.76.",
  "93.158.188.",
] as const;

export function getPreviewRewritePath(
  request: PreviewRequestContext,
): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  if (!isLikelyPreviewRequest(request.headers)) {
    return null;
  }

  const pathname = stripBasePath(request.pathname, request.basePath);
  if (pathname === "/") {
    return "/api/preview/site";
  }

  const petMatch = pathname.match(/^\/pets\/([^/]+)$/);
  if (petMatch) {
    return `/api/preview/pets/${petMatch[1]}`;
  }

  return null;
}

export function isLikelyPreviewRequest(headers: HeaderReader): boolean {
  const userAgent = headers.get("user-agent") ?? "";
  if (PREVIEW_USER_AGENT_RE.test(userAgent)) {
    return true;
  }

  const ip = getRequestIp(headers);
  return Boolean(
    ip &&
      TELEGRAM_PREVIEW_IP_PREFIXES.some((prefix) => ip.startsWith(prefix)) &&
      TELEGRAM_BROWSERISH_USER_AGENT_RE.test(userAgent),
  );
}

export function withRequestBasePath(path: string, basePath?: string): string {
  if (!basePath) {
    return path;
  }

  if (path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }

  return path === "/" ? basePath : `${basePath}${path}`;
}

function getRequestIp(headers: HeaderReader): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  return realIp || null;
}

function stripBasePath(pathname: string, basePath?: string): string {
  if (!basePath || pathname === basePath) {
    return pathname === basePath ? "/" : pathname;
  }

  return pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length) || "/"
    : pathname;
}
