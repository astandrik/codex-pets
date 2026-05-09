import { randomBytes } from "node:crypto";

import { TypedValues, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type AuthRole = "user" | "admin";
export type AuthUserStatus = "active" | "pending_email_verification" | "disabled";

export type AuthUser = {
  userId: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  displayName: string;
  role: AuthRole;
  status: AuthUserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  sessionId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_DAYS = 30;

export function normalizeEmail(value: string): {
  email: string;
  emailLower: string;
} | null {
  const email = value.trim();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return { email, emailLower: email.toLowerCase() };
}

export function getBootstrapAdminEmails(): string[] {
  return (process.env.INITIAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getRoleForEmail(emailLower: string): AuthRole {
  return getBootstrapAdminEmails().includes(emailLower) ? "admin" : "user";
}

export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
SELECT user_id, email, email_lower, password_hash, display_name, role, status, email_verified_at, created_at, updated_at
FROM ${TABLES.users}
WHERE user_id = $user_id
LIMIT 1;
      `,
      { $user_id: TypedValues.utf8(normalized.emailLower) },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? parseUserRow(row) : null;
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
SELECT user_id, email, email_lower, password_hash, display_name, role, status, email_verified_at, created_at, updated_at
FROM ${TABLES.users}
WHERE user_id = $user_id
LIMIT 1;
      `,
      { $user_id: TypedValues.utf8(userId) },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? parseUserRow(row) : null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<AuthUser> {
  const normalized = normalizeEmail(input.email);
  if (!normalized) {
    throw new Error("Invalid email.");
  }

  const existing = await getUserByEmail(normalized.email);
  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const now = new Date().toISOString();
  const userId = normalized.emailLower;
  const role = getRoleForEmail(normalized.emailLower);

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
DECLARE $email AS Utf8;
DECLARE $email_lower AS Utf8;
DECLARE $password_hash AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $role AS Utf8;
DECLARE $status AS Utf8;
DECLARE $email_verified_at AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.users}
(user_id, email, email_lower, password_hash, display_name, role, status, email_verified_at, created_at, updated_at)
VALUES ($user_id, $email, $email_lower, $password_hash, $display_name, $role, $status, $email_verified_at, $created_at, $updated_at);
      `,
      {
        $user_id: TypedValues.utf8(userId),
        $email: TypedValues.utf8(normalized.email),
        $email_lower: TypedValues.utf8(normalized.emailLower),
        $password_hash: TypedValues.utf8(input.passwordHash),
        $display_name: TypedValues.utf8(input.displayName),
        $role: TypedValues.utf8(role),
        $status: TypedValues.utf8("active"),
        $email_verified_at: TypedValues.utf8(""),
        $created_at: TypedValues.utf8(now),
        $updated_at: TypedValues.utf8(now),
      },
    ),
  );

  return {
    userId,
    email: normalized.email,
    emailLower: normalized.emailLower,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    role,
    status: "active",
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createSessionForUser(userId: string): Promise<AuthSession> {
  const sessionId = randomBytes(24).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $session_id AS Utf8;
DECLARE $user_id AS Utf8;
DECLARE $expires_at AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.sessions}
(session_id, user_id, expires_at, created_at)
VALUES ($session_id, $user_id, $expires_at, $created_at);
      `,
      {
        $session_id: TypedValues.utf8(sessionId),
        $user_id: TypedValues.utf8(userId),
        $expires_at: TypedValues.utf8(expiresAt.toISOString()),
        $created_at: TypedValues.utf8(createdAt.toISOString()),
      },
    ),
  );

  return {
    sessionId,
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: createdAt.toISOString(),
  };
}

export async function getSessionById(sessionId: string): Promise<AuthSession | null> {
  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $session_id AS Utf8;
SELECT session_id, user_id, expires_at, created_at
FROM ${TABLES.sessions}
WHERE session_id = $session_id
LIMIT 1;
      `,
      { $session_id: TypedValues.utf8(sessionId) },
    ),
  );

  const row = rowsFromResult(result)[0];
  if (!row) return null;
  return {
    sessionId: textAt(row, 0),
    userId: textAt(row, 1),
    expiresAt: textAt(row, 2),
    createdAt: textAt(row, 3),
  };
}

export async function updateUserRole(
  userId: string,
  role: AuthRole,
): Promise<void> {
  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
DECLARE $role AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.users}
SET role = $role,
    updated_at = $updated_at
WHERE user_id = $user_id;
      `,
      {
        $user_id: TypedValues.utf8(userId),
        $role: TypedValues.utf8(role),
        $updated_at: TypedValues.utf8(new Date().toISOString()),
      },
    ),
  );
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $session_id AS Utf8;
DELETE FROM ${TABLES.sessions}
WHERE session_id = $session_id;
      `,
      { $session_id: TypedValues.utf8(sessionId) },
    ),
  );
}

function parseUserRow(row: Parameters<typeof textAt>[0]): AuthUser {
  return {
    userId: textAt(row, 0),
    email: textAt(row, 1),
    emailLower: textAt(row, 2),
    passwordHash: textAt(row, 3),
    displayName: textAt(row, 4),
    role: textAt(row, 5) === "admin" ? "admin" : "user",
    status: parseUserStatus(textAt(row, 6)),
    emailVerifiedAt: textAt(row, 7) || null,
    createdAt: textAt(row, 8),
    updatedAt: textAt(row, 9),
  };
}

function parseUserStatus(value: string): AuthUserStatus {
  if (value === "disabled") return "disabled";
  if (value === "pending_email_verification") {
    return "pending_email_verification";
  }
  return "active";
}
