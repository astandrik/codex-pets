import { randomBytes } from "node:crypto";
import type { Session } from "ydb-sdk";

import { TypedValues, isYdbConfigured, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";
import {
  MOCK_LOCAL_ADMIN_AVATAR_ID,
  avatarUrlFromId,
} from "@/lib/auth/avatar-repository";
import {
  isMockPetsDataSource,
  listMockPetRecords,
} from "@/lib/pets/mock-data";

export type AuthRole = "user" | "admin";
export type AuthUserStatus = "active" | "pending_email_verification" | "disabled";

export type AuthUser = {
  userId: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  displayName: string;
  profileSlug: string;
  bio: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  avatarId: string | null;
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

export type PublicUserProfile = {
  userId: string;
  displayName: string;
  profileSlug: string;
  bio: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicUserReference = Pick<
  PublicUserProfile,
  "userId" | "displayName" | "profileSlug" | "avatarUrl"
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const SESSION_TTL_DAYS = 30;
const PROFILE_SLUG_CREATE_ATTEMPTS = 100;
const RESERVED_PROFILE_SLUGS = new Set([
  "about",
  "admin",
  "agents",
  "api",
  "login",
  "logout",
  "mcp",
  "my-pets",
  "my-requests",
  "pets",
  "profile",
  "register",
  "request",
  "submit",
  "users",
]);

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

export function normalizeProfileSlug(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  if (!PROFILE_SLUG_PATTERN.test(slug) || RESERVED_PROFILE_SLUGS.has(slug)) {
    return null;
  }

  return slug;
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
  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
SELECT ${userColumns()}
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
  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
SELECT ${userColumns()}
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

export async function getPublicUserProfileBySlug(
  profileSlug: string,
): Promise<PublicUserProfile | null> {
  const normalized = normalizeProfileSlug(profileSlug);
  if (!normalized) return null;

  if (isMockPetsDataSource()) {
    return getMockPublicUserProfiles().find(
      (profile) => profile.profileSlug === normalized,
    ) ?? null;
  }

  const user = await getAuthUserByProfileSlug(normalized);
  if (!user || user.status !== "active") return null;
  return toPublicUserProfile(user);
}

export async function listPublicUserProfiles(): Promise<PublicUserProfile[]> {
  if (isMockPetsDataSource()) {
    return getMockPublicUserProfiles();
  }

  if (!isYdbConfigured()) return [];

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $status AS Utf8;
SELECT ${userColumns()}
FROM ${TABLES.users}
WHERE status = $status
ORDER BY created_at DESC
LIMIT 500;
      `,
      { $status: TypedValues.utf8("active") },
    ),
  );

  return rowsFromResult(result)
    .map(parseUserRow)
    .filter((user) => Boolean(user.profileSlug))
    .map(toPublicUserProfile);
}

export async function listPublicUserProfilesByIds(
  userIds: string[],
): Promise<Map<string, PublicUserReference>> {
  if (isMockPetsDataSource()) {
    const requestedUserIds = new Set(userIds);
    return new Map(
      getMockPublicUserProfiles()
        .filter((profile) => requestedUserIds.has(profile.userId))
        .map((profile) => [
          profile.userId,
          {
            userId: profile.userId,
            displayName: profile.displayName,
            profileSlug: profile.profileSlug,
            avatarUrl: profile.avatarUrl,
          },
        ]),
    );
  }

  if (!isYdbConfigured() || userIds.length === 0) return new Map();

  const uniqueUserIds = Array.from(
    new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  );
  if (uniqueUserIds.length === 0) return new Map();

  const declarations = uniqueUserIds
    .map((_, index) => `DECLARE $user${index} AS Utf8;`)
    .join("\n");
  const predicate = uniqueUserIds
    .map((_, index) => `user_id = $user${index}`)
    .join(" OR ");
  const params = Object.fromEntries(
    uniqueUserIds.map((userId, index) => [
      `$user${index}`,
      TypedValues.utf8(userId),
    ]),
  );

  const result = await withSession((session) =>
    session.executeQuery(
      `
${declarations}
DECLARE $status AS Utf8;
SELECT ${userColumns()}
FROM ${TABLES.users}
WHERE status = $status AND (${predicate});
      `,
      {
        ...params,
        $status: TypedValues.utf8("active"),
      },
    ),
  );

  const profiles = new Map<string, PublicUserReference>();
  for (const user of rowsFromResult(result).map(parseUserRow)) {
    if (!user.profileSlug) continue;
    profiles.set(user.userId, {
      userId: user.userId,
      displayName: user.displayName,
      profileSlug: user.profileSlug,
      avatarUrl: avatarUrlFromId(user.avatarId),
    });
  }
  return profiles;
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

  const userId = normalized.emailLower;
  const role = getRoleForEmail(normalized.emailLower);
  const baseProfileSlug =
    normalizeProfileSlug(input.displayName) ??
    normalizeProfileSlug(normalized.email.split("@")[0]) ??
    `user-${randomBytes(4).toString("hex")}`;

  for (let index = 0; index < PROFILE_SLUG_CREATE_ATTEMPTS; index += 1) {
    const profileSlug = profileSlugCandidate(baseProfileSlug, index);
    const user = await tryCreateUserWithProfileSlug({
      email: normalized.email,
      emailLower: normalized.emailLower,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      userId,
      role,
      profileSlug,
    });
    if (user) return user;
  }

  const fallbackProfileSlug = `${baseProfileSlug.slice(0, 31)}-${randomBytes(4).toString("hex")}`;
  const user = await tryCreateUserWithProfileSlug({
    email: normalized.email,
    emailLower: normalized.emailLower,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    userId,
    role,
    profileSlug: fallbackProfileSlug,
  });
  if (user) return user;

  throw new Error("Unable to allocate a profile handle.");
}

export async function updateUserProfile(input: {
  userId: string;
  displayName: string;
  profileSlug: string;
  bio: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
}): Promise<AuthUser | null> {
  const profileSlug = normalizeProfileSlug(input.profileSlug);
  if (!profileSlug) {
    throw new Error("invalid_profile_slug");
  }

  const now = new Date().toISOString();
  const updated = await withSerializableTransaction(async (session, txControl) => {
    const current = await getUserByIdInTransaction(session, txControl, input.userId);
    if (!current) return null;

    await reserveProfileSlugInTransaction({
      session,
      txControl,
      profileSlug,
      userId: input.userId,
      now,
    });

    await session.executeQuery(
      `
DECLARE $user_id AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $profile_slug AS Utf8;
DECLARE $bio AS Utf8;
DECLARE $website_url AS Utf8;
DECLARE $github_url AS Utf8;
DECLARE $linkedin_url AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.users}
SET display_name = $display_name,
    profile_slug = $profile_slug,
    bio = $bio,
    website_url = $website_url,
    github_url = $github_url,
    linkedin_url = $linkedin_url,
    updated_at = $updated_at
WHERE user_id = $user_id;
      `,
      {
        $user_id: TypedValues.utf8(input.userId),
        $display_name: TypedValues.utf8(input.displayName),
        $profile_slug: TypedValues.utf8(profileSlug),
        $bio: TypedValues.utf8(input.bio ?? ""),
        $website_url: TypedValues.utf8(input.websiteUrl ?? ""),
        $github_url: TypedValues.utf8(input.githubUrl ?? ""),
        $linkedin_url: TypedValues.utf8(input.linkedinUrl ?? ""),
        $updated_at: TypedValues.utf8(now),
      },
      txControl,
    );

    if (current.profileSlug && current.profileSlug !== profileSlug) {
      await releaseProfileSlugInTransaction({
        session,
        txControl,
        profileSlug: current.profileSlug,
        userId: input.userId,
      });
    }

    return {
      ...current,
      displayName: input.displayName,
      profileSlug,
      bio: input.bio,
      websiteUrl: input.websiteUrl,
      githubUrl: input.githubUrl,
      linkedinUrl: input.linkedinUrl,
      updatedAt: now,
    };
  });

  return updated;
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

async function getAuthUserByProfileSlug(
  profileSlug: string,
): Promise<AuthUser | null> {
  if (!isYdbConfigured()) return null;

  const ownerId = await getProfileSlugOwner(profileSlug);
  if (ownerId) return getUserById(ownerId);

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $profile_slug AS Utf8;
SELECT ${userColumns()}
FROM ${TABLES.users}
WHERE profile_slug = $profile_slug
LIMIT 1;
      `,
      { $profile_slug: TypedValues.utf8(profileSlug) },
    ),
  );

  const row = rowsFromResult(result)[0];
  return row ? parseUserRow(row) : null;
}

type TxControl = { txId: string };

async function withSerializableTransaction<T>(
  fn: (session: Session, txControl: TxControl) => Promise<T>,
): Promise<T> {
  return withSession(async (session) => {
    const tx = await session.beginTransaction({ serializableReadWrite: {} });
    if (!tx.id) {
      throw new Error("Unable to start YDB transaction.");
    }
    const txControl = { txId: tx.id };

    try {
      const result = await fn(session, txControl);
      await session.commitTransaction(txControl);
      return result;
    } catch (error) {
      try {
        await session.rollbackTransaction(txControl);
      } catch {
        // The transaction may already be aborted or committed by YDB.
      }
      throw error;
    }
  });
}

async function tryCreateUserWithProfileSlug(input: {
  userId: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  displayName: string;
  role: AuthRole;
  profileSlug: string;
}): Promise<AuthUser | null> {
  try {
    return await withSerializableTransaction(async (session, txControl) => {
      const existing = await getUserByIdInTransaction(
        session,
        txControl,
        input.userId,
      );
      if (existing) {
        throw new Error("An account with this email already exists.");
      }

      const now = new Date().toISOString();
      await reserveProfileSlugInTransaction({
        session,
        txControl,
        profileSlug: input.profileSlug,
        userId: input.userId,
        now,
      });

      await session.executeQuery(
        `
DECLARE $user_id AS Utf8;
DECLARE $email AS Utf8;
DECLARE $email_lower AS Utf8;
DECLARE $password_hash AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $profile_slug AS Utf8;
DECLARE $bio AS Utf8;
DECLARE $website_url AS Utf8;
DECLARE $github_url AS Utf8;
DECLARE $linkedin_url AS Utf8;
DECLARE $avatar_id AS Utf8;
DECLARE $role AS Utf8;
DECLARE $status AS Utf8;
DECLARE $email_verified_at AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.users}
(user_id, email, email_lower, password_hash, display_name, profile_slug, bio, website_url, github_url, linkedin_url, avatar_id, role, status, email_verified_at, created_at, updated_at)
VALUES ($user_id, $email, $email_lower, $password_hash, $display_name, $profile_slug, $bio, $website_url, $github_url, $linkedin_url, $avatar_id, $role, $status, $email_verified_at, $created_at, $updated_at);
        `,
        {
          $user_id: TypedValues.utf8(input.userId),
          $email: TypedValues.utf8(input.email),
          $email_lower: TypedValues.utf8(input.emailLower),
          $password_hash: TypedValues.utf8(input.passwordHash),
          $display_name: TypedValues.utf8(input.displayName),
          $profile_slug: TypedValues.utf8(input.profileSlug),
          $bio: TypedValues.utf8(""),
          $website_url: TypedValues.utf8(""),
          $github_url: TypedValues.utf8(""),
          $linkedin_url: TypedValues.utf8(""),
          $avatar_id: TypedValues.utf8(""),
          $role: TypedValues.utf8(input.role),
          $status: TypedValues.utf8("active"),
          $email_verified_at: TypedValues.utf8(""),
          $created_at: TypedValues.utf8(now),
          $updated_at: TypedValues.utf8(now),
        },
        txControl,
      );

      return {
        userId: input.userId,
        email: input.email,
        emailLower: input.emailLower,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        profileSlug: input.profileSlug,
        bio: null,
        websiteUrl: null,
        githubUrl: null,
        linkedinUrl: null,
        avatarId: null,
        role: input.role,
        status: "active",
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "profile_slug_taken") {
      return null;
    }
    throw error;
  }
}

async function getUserByIdInTransaction(
  session: Session,
  txControl: TxControl,
  userId: string,
): Promise<AuthUser | null> {
  const result = await session.executeQuery(
    `
DECLARE $user_id AS Utf8;
SELECT ${userColumns()}
FROM ${TABLES.users}
WHERE user_id = $user_id
LIMIT 1;
    `,
    { $user_id: TypedValues.utf8(userId) },
    txControl,
  );

  const row = rowsFromResult(result)[0];
  return row ? parseUserRow(row) : null;
}

async function getProfileSlugOwner(profileSlug: string): Promise<string | null> {
  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $profile_slug AS Utf8;
SELECT user_id
FROM ${TABLES.userProfileSlugs}
WHERE profile_slug = $profile_slug
LIMIT 1;
      `,
      { $profile_slug: TypedValues.utf8(profileSlug) },
    ),
  );

  return textAt(rowsFromResult(result)[0] ?? {}, 0) || null;
}

async function getProfileSlugOwnerInTransaction(
  session: Session,
  txControl: TxControl,
  profileSlug: string,
): Promise<string | null> {
  const result = await session.executeQuery(
    `
DECLARE $profile_slug AS Utf8;
SELECT user_id
FROM ${TABLES.userProfileSlugs}
WHERE profile_slug = $profile_slug
LIMIT 1;
    `,
    { $profile_slug: TypedValues.utf8(profileSlug) },
    txControl,
  );

  return textAt(rowsFromResult(result)[0] ?? {}, 0) || null;
}

async function reserveProfileSlugInTransaction(input: {
  session: Session;
  txControl: TxControl;
  profileSlug: string;
  userId: string;
  now: string;
}): Promise<void> {
  const ownerId = await getProfileSlugOwnerInTransaction(
    input.session,
    input.txControl,
    input.profileSlug,
  );
  if (ownerId && ownerId !== input.userId) {
    throw new Error("profile_slug_taken");
  }
  if (!ownerId) {
    const legacyOwnerId = await getLegacyProfileSlugOwnerInTransaction(
      input.session,
      input.txControl,
      input.profileSlug,
    );
    if (legacyOwnerId && legacyOwnerId !== input.userId) {
      throw new Error("profile_slug_taken");
    }
  }

  await input.session.executeQuery(
    `
DECLARE $profile_slug AS Utf8;
DECLARE $user_id AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.userProfileSlugs}
(profile_slug, user_id, created_at, updated_at)
VALUES ($profile_slug, $user_id, $created_at, $updated_at);
    `,
    {
      $profile_slug: TypedValues.utf8(input.profileSlug),
      $user_id: TypedValues.utf8(input.userId),
      $created_at: TypedValues.utf8(input.now),
      $updated_at: TypedValues.utf8(input.now),
    },
    input.txControl,
  );
}

async function releaseProfileSlugInTransaction(input: {
  session: Session;
  txControl: TxControl;
  profileSlug: string;
  userId: string;
}): Promise<void> {
  const ownerId = await getProfileSlugOwnerInTransaction(
    input.session,
    input.txControl,
    input.profileSlug,
  );
  if (ownerId !== input.userId) return;

  await input.session.executeQuery(
    `
DECLARE $profile_slug AS Utf8;
DELETE FROM ${TABLES.userProfileSlugs}
WHERE profile_slug = $profile_slug;
    `,
    { $profile_slug: TypedValues.utf8(input.profileSlug) },
    input.txControl,
  );
}

async function getLegacyProfileSlugOwnerInTransaction(
  session: Session,
  txControl: TxControl,
  profileSlug: string,
): Promise<string | null> {
  const result = await session.executeQuery(
    `
DECLARE $profile_slug AS Utf8;
SELECT user_id
FROM ${TABLES.users}
WHERE profile_slug = $profile_slug
LIMIT 1;
    `,
    { $profile_slug: TypedValues.utf8(profileSlug) },
    txControl,
  );

  return textAt(rowsFromResult(result)[0] ?? {}, 0) || null;
}

function profileSlugCandidate(base: string, index: number): string {
  if (index === 0) return base;
  const suffix = `-${index + 1}`;
  return `${base.slice(0, 40 - suffix.length)}${suffix}`;
}

function userColumns(): string {
  return [
    "user_id",
    "email",
    "email_lower",
    "password_hash",
    "display_name",
    "profile_slug",
    "bio",
    "website_url",
    "github_url",
    "linkedin_url",
    "avatar_id",
    "role",
    "status",
    "email_verified_at",
    "created_at",
    "updated_at",
  ].join(", ");
}

function parseUserRow(row: Parameters<typeof textAt>[0]): AuthUser {
  return {
    userId: textAt(row, 0),
    email: textAt(row, 1),
    emailLower: textAt(row, 2),
    passwordHash: textAt(row, 3),
    displayName: textAt(row, 4),
    profileSlug: textAt(row, 5),
    bio: textAt(row, 6) || null,
    websiteUrl: textAt(row, 7) || null,
    githubUrl: textAt(row, 8) || null,
    linkedinUrl: textAt(row, 9) || null,
    avatarId: textAt(row, 10) || null,
    role: textAt(row, 11) === "admin" ? "admin" : "user",
    status: parseUserStatus(textAt(row, 12)),
    emailVerifiedAt: textAt(row, 13) || null,
    createdAt: textAt(row, 14),
    updatedAt: textAt(row, 15),
  };
}

function toPublicUserProfile(user: AuthUser): PublicUserProfile {
  return {
    userId: user.userId,
    displayName: user.displayName,
    profileSlug: user.profileSlug,
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    githubUrl: user.githubUrl,
    linkedinUrl: user.linkedinUrl,
    avatarUrl: avatarUrlFromId(user.avatarId),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function getMockPublicUserProfiles(): PublicUserProfile[] {
  const profiles = new Map<string, PublicUserProfile>();

  for (const pet of listMockPetRecords()) {
    if (!pet.ownerId || !pet.ownerName || profiles.has(pet.ownerId)) {
      continue;
    }

    const profileSlug =
      normalizeProfileSlug(pet.ownerId) ??
      normalizeProfileSlug(pet.ownerName) ??
      "local-user";
    const links = getMockPublicProfileLinks(profileSlug);
    profiles.set(pet.ownerId, {
      userId: pet.ownerId,
      displayName: pet.ownerName,
      profileSlug,
      bio: links.bio,
      websiteUrl: links.websiteUrl,
      githubUrl: links.githubUrl,
      linkedinUrl: links.linkedinUrl,
      avatarUrl: links.avatarId ? avatarUrlFromId(links.avatarId) : null,
      createdAt: pet.createdAt,
      updatedAt: pet.updatedAt,
    });
  }

  return Array.from(profiles.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function getMockPublicProfileLinks(profileSlug: string): Pick<
  PublicUserProfile,
  "bio" | "websiteUrl" | "githubUrl" | "linkedinUrl"
> & {
  avatarId: string | null;
} {
  if (profileSlug === "local-admin") {
    return {
      bio: "Maintains the local Codex Pets mock registry and publishes sample packs for UI testing.",
      websiteUrl: "https://tech.ydb-qdrant.pets/",
      githubUrl: "https://github.com/astandrik/codex-pets",
      linkedinUrl: "https://www.linkedin.com/company/ydb/",
      avatarId: MOCK_LOCAL_ADMIN_AVATAR_ID,
    };
  }

  return {
    bio: null,
    websiteUrl: null,
    githubUrl: null,
    linkedinUrl: null,
    avatarId: null,
  };
}

function parseUserStatus(value: string): AuthUserStatus {
  if (value === "disabled") return "disabled";
  if (value === "pending_email_verification") {
    return "pending_email_verification";
  }
  return "active";
}
