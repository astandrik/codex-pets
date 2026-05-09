import { NextResponse } from "next/server";

import { withBasePath } from "@/lib/base-path";
import { clearSessionCookie, decodeSessionCookie } from "@/lib/auth/session-cookie";
import { deleteSessionById } from "@/lib/auth/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");
  const requestUrl = new URL(req.url);
  const origin = `${forwardedProto ?? requestUrl.protocol.replace(":", "")}://${
    forwardedHost ?? host ?? requestUrl.host
  }`;
  const response = NextResponse.redirect(new URL(withBasePath("/"), origin));
  const sessionId = decodeSessionCookie(
    req.headers
      .get("cookie")
      ?.match(/codex_pets_session=([^;]+)/)?.[1],
  );

  if (sessionId) {
    await deleteSessionById(sessionId).catch(() => {});
  }
  clearSessionCookie(response);
  return response;
}
