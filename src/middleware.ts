import { NextResponse, type NextRequest } from "next/server";

import { BASE_PATH } from "@/lib/base-path";
import { getPreviewRewritePath } from "@/lib/preview/request";

export function middleware(request: NextRequest): Response {
  const basePath = request.nextUrl.basePath || BASE_PATH || undefined;
  const rewritePath = getPreviewRewritePath({
    method: request.method,
    pathname: request.nextUrl.pathname,
    basePath,
    headers: request.headers,
  });

  if (!rewritePath) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = rewritePath;

  return NextResponse.rewrite(rewriteUrl);
}
