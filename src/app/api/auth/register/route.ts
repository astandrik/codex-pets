import { NextResponse } from "next/server";

import { createUser, createSessionForUser, getUserByEmail, normalizeEmail } from "@/lib/auth/repository";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { applySessionCookie } from "@/lib/auth/session-cookie";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if ((process.env.AUTH_MODE?.trim() ?? "app-session") !== "app-session") {
    return NextResponse.json({ error: "auth_mode_disabled" }, { status: 503 });
  }
  if (!isYdbConfigured()) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayNameRaw = typeof body.displayName === "string" ? body.displayName.trim() : "";

  const normalized = normalizeEmail(email);
  if (!normalized) {
    return NextResponse.json(
      { error: "invalid_email", message: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json(
      { error: "weak_password", message: passwordError },
      { status: 400 },
    );
  }

  const existing = await getUserByEmail(normalized.email);
  if (existing) {
    return NextResponse.json(
      { error: "email_taken", message: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const displayName =
    displayNameRaw ||
    normalized.email.split("@")[0] ||
    normalized.emailLower;

  const user = await createUser({
    email: normalized.email,
    passwordHash,
    displayName: displayName.slice(0, 80),
  });
  const session = await createSessionForUser(user.userId);

  const response = NextResponse.json({ ok: true }, { status: 201 });
  applySessionCookie(response, {
    sessionId: session.sessionId,
    expiresAt: new Date(session.expiresAt),
  });
  return response;
}
