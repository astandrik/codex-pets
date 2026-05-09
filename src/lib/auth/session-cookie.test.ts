import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  applySessionCookie,
  clearSessionCookie,
  decodeSessionCookie,
  encodeSessionCookie,
} from "@/lib/auth/session-cookie";

describe("session cookie helpers", () => {
  it("encodes and decodes signed session ids", () => {
    vi.stubEnv("SESSION_COOKIE_SECRET", "cookie-secret");

    const encoded = encodeSessionCookie("session_1");
    expect(decodeSessionCookie(encoded)).toBe("session_1");
    expect(decodeSessionCookie(`${encoded}x`)).toBeNull();

    vi.unstubAllEnvs();
  });

  it("sets and clears session cookies", () => {
    vi.stubEnv("SESSION_COOKIE_SECRET", "cookie-secret");

    const response = NextResponse.json({ ok: true });
    applySessionCookie(response, {
      sessionId: "session_1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(response.headers.get("set-cookie")).toContain("codex_pets_session=");

    const cleared = NextResponse.json({ ok: true });
    clearSessionCookie(cleared);
    expect(cleared.headers.get("set-cookie")).toContain("Expires=");

    vi.unstubAllEnvs();
  });
});
