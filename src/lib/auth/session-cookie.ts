import { createHmac } from "node:crypto";

import type { NextResponse } from "next/server";

import { BASE_PATH } from "@/lib/base-path";

export const SESSION_COOKIE_NAME = "codex_pets_session";

function getSessionCookieSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_COOKIE_SECRET is required for app-session auth.");
  }
  return secret;
}

function signSessionId(sessionId: string): string {
  return createHmac("sha256", getSessionCookieSecret())
    .update(sessionId)
    .digest("base64url");
}

export function encodeSessionCookie(sessionId: string): string {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

export function decodeSessionCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [sessionId, signature] = value.split(".");
  if (!sessionId || !signature) return null;
  return signature === signSessionId(sessionId) ? sessionId : null;
}

export function applySessionCookie(
  response: NextResponse,
  input: { sessionId: string; expiresAt: Date },
): void {
  response.cookies.set(SESSION_COOKIE_NAME, encodeSessionCookie(input.sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: input.expiresAt,
    path: BASE_PATH || "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: BASE_PATH || "/",
  });
}
