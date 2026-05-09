import { cookies, headers } from "next/headers";

import {
  decodeSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-cookie";
import { getSessionById, getUserById, getRoleForEmail } from "@/lib/auth/repository";

export type AppPrincipal = {
  userId: string;
  email: string | null;
  name: string | null;
  role: "user" | "admin";
};

type AuthMode = "app-session" | "disabled" | "single-user" | "proxy-basic";

function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE?.trim() ?? "app-session";
  if (
    mode === "app-session" ||
    mode === "disabled" ||
    mode === "single-user" ||
    mode === "proxy-basic"
  ) {
    return mode;
  }
  return "app-session";
}

export async function getCurrentPrincipal(): Promise<AppPrincipal | null> {
  const mode = getAuthMode();
  if (mode === "disabled") {
    return null;
  }

  if (mode === "single-user") {
    const userId = process.env.AUTH_SINGLE_USER_ID?.trim() || "local-admin";
    const email = process.env.AUTH_SINGLE_USER_EMAIL?.trim() || null;
    const name =
      process.env.AUTH_SINGLE_USER_NAME?.trim() || email?.split("@")[0] || userId;
    return { userId, email, name, role: "admin" };
  }

  if (mode === "app-session") {
    const cookieStore = await cookies();
    const sessionId = decodeSessionCookie(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
    );
    if (!sessionId) {
      return null;
    }

    const session = await getSessionById(sessionId);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      return null;
    }

    const user = await getUserById(session.userId);
    if (!user || user.status === "disabled") {
      return null;
    }

    return {
      userId: user.userId,
      email: user.email,
      name: user.displayName || user.email.split("@")[0] || user.userId,
      role: user.role,
    };
  }

  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-remote-user")?.trim();
  if (!userId) {
    return null;
  }

  const email = requestHeaders.get("x-remote-email")?.trim() || null;
  const name =
    requestHeaders.get("x-remote-name")?.trim() || email?.split("@")[0] || userId;
  const role =
    email && getRoleForEmail(email.toLowerCase()) === "admin" ? "admin" : "user";
  return { userId, email, name, role };
}

export function isAdminUser(
  principal: Pick<AppPrincipal, "role"> | null | undefined,
): boolean {
  return principal?.role === "admin";
}
