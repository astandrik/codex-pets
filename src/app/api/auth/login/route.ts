import { NextResponse } from "next/server";

import { createSessionForUser, getUserByEmail, getRoleForEmail, updateUserRole } from "@/lib/auth/repository";
import { verifyPassword } from "@/lib/auth/password";
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

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "Invalid email or password." },
      { status: 401 },
    );
  }
  if (user.status === "disabled") {
    return NextResponse.json(
      { error: "account_disabled", message: "This account is disabled." },
      { status: 403 },
    );
  }

  const expectedRole = getRoleForEmail(user.emailLower);
  if (expectedRole !== user.role) {
    await updateUserRole(user.userId, expectedRole);
  }

  const session = await createSessionForUser(user.userId);
  const response = NextResponse.json({ ok: true });
  applySessionCookie(response, {
    sessionId: session.sessionId,
    expiresAt: new Date(session.expiresAt),
  });
  return response;
}
