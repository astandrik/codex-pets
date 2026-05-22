import { randomBytes } from "node:crypto";

import sharp from "sharp";

import { withBasePath } from "@/lib/base-path";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export const USER_AVATAR_SIZE = 256;
export const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;
export const USER_AVATAR_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const MOCK_LOCAL_ADMIN_AVATAR_ID = "mock-local-admin";

type ProcessAvatarResult =
  | {
      ok: true;
      buffer: Buffer;
      contentType: "image/webp";
      sizeBytes: number;
    }
  | {
      ok: false;
      error: "invalid_avatar_type" | "avatar_too_large" | "invalid_avatar_image";
      message: string;
    };

export type UserAvatar = {
  avatarId: string;
  userId: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
  createdAt: string;
  updatedAt: string;
};

let mockLocalAdminAvatar: Promise<Buffer> | null = null;

export function avatarUrlFromId(avatarId: string | null | undefined): string | null {
  const normalized = avatarId?.trim();
  if (!normalized) return null;
  return withBasePath(`/api/users/avatars/${encodeURIComponent(normalized)}`);
}

export async function processUserAvatarImage(input: {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
}): Promise<ProcessAvatarResult> {
  if (!USER_AVATAR_CONTENT_TYPES.has(input.contentType)) {
    return {
      ok: false,
      error: "invalid_avatar_type",
      message: "Avatar must be a PNG, JPEG, or WebP image.",
    };
  }

  if (input.sizeBytes > MAX_USER_AVATAR_BYTES) {
    return {
      ok: false,
      error: "avatar_too_large",
      message: "Avatar image must be 5 MB or smaller.",
    };
  }

  try {
    const buffer = await sharp(input.buffer)
      .rotate()
      .resize(USER_AVATAR_SIZE, USER_AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 86 })
      .toBuffer();

    return {
      ok: true,
      buffer,
      contentType: "image/webp",
      sizeBytes: buffer.byteLength,
    };
  } catch {
    return {
      ok: false,
      error: "invalid_avatar_image",
      message: "Avatar image could not be read.",
    };
  }
}

export async function storeUserAvatar(input: {
  userId: string;
  buffer: Buffer;
  sizeBytes: number;
}): Promise<{
  avatarId: string;
  avatarUrl: string;
}> {
  const previousAvatarId = await getUserAvatarId(input.userId);
  const avatarId = `avatar_${randomBytes(16).toString("hex")}`;
  const now = new Date().toISOString();

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $avatar_id AS Utf8;
DECLARE $user_id AS Utf8;
DECLARE $content_type AS Utf8;
DECLARE $size_bytes AS Uint32;
DECLARE $image_bytes AS String;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.userAvatars}
(avatar_id, user_id, content_type, size_bytes, image_bytes, created_at, updated_at)
VALUES ($avatar_id, $user_id, $content_type, $size_bytes, $image_bytes, $created_at, $updated_at);
      `,
      {
        $avatar_id: TypedValues.utf8(avatarId),
        $user_id: TypedValues.utf8(input.userId),
        $content_type: TypedValues.utf8("image/webp"),
        $size_bytes: TypedValues.uint32(input.sizeBytes),
        $image_bytes: TypedValues.bytes(input.buffer),
        $created_at: TypedValues.utf8(now),
        $updated_at: TypedValues.utf8(now),
      },
    ),
  );

  await setUserAvatarId(input.userId, avatarId, now);
  await deleteUserAvatar(previousAvatarId);

  return {
    avatarId,
    avatarUrl: avatarUrlFromId(avatarId) ?? "",
  };
}

export async function clearUserAvatar(userId: string): Promise<void> {
  const previousAvatarId = await getUserAvatarId(userId);
  await setUserAvatarId(userId, "", new Date().toISOString());
  await deleteUserAvatar(previousAvatarId);
}

export async function readUserAvatar(avatarId: string): Promise<UserAvatar | null> {
  const normalized = avatarId.trim();
  if (!normalized) return null;

  if (isMockPetsDataSource() && normalized === MOCK_LOCAL_ADMIN_AVATAR_ID) {
    const buffer = await getMockLocalAdminAvatar();
    const now = "2026-05-01T00:00:00.000Z";
    return {
      avatarId: normalized,
      userId: "local-admin",
      contentType: "image/webp",
      sizeBytes: buffer.byteLength,
      buffer,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!isYdbConfigured()) return null;

  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $avatar_id AS Utf8;
SELECT avatar_id, user_id, content_type, size_bytes, image_bytes, created_at, updated_at
FROM ${TABLES.userAvatars}
WHERE avatar_id = $avatar_id
LIMIT 1;
      `,
      {
        $avatar_id: TypedValues.utf8(normalized),
      },
    ),
  );

  const row = rowsFromResult(result)[0];
  if (!row) return null;
  return {
    avatarId: textAt(row, 0),
    userId: textAt(row, 1),
    contentType: textAt(row, 2) || "image/webp",
    sizeBytes: uintAt(row, 3),
    buffer: bytesAt(row, 4),
    createdAt: textAt(row, 5),
    updatedAt: textAt(row, 6),
  };
}

async function getUserAvatarId(userId: string): Promise<string | null> {
  const result = await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
SELECT avatar_id
FROM ${TABLES.users}
WHERE user_id = $user_id
LIMIT 1;
      `,
      {
        $user_id: TypedValues.utf8(userId),
      },
    ),
  );

  const avatarId = textAt(rowsFromResult(result)[0] ?? {}, 0).trim();
  return avatarId || null;
}

async function setUserAvatarId(
  userId: string,
  avatarId: string,
  updatedAt: string,
): Promise<void> {
  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $user_id AS Utf8;
DECLARE $avatar_id AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.users}
SET avatar_id = $avatar_id,
    updated_at = $updated_at
WHERE user_id = $user_id;
      `,
      {
        $user_id: TypedValues.utf8(userId),
        $avatar_id: TypedValues.utf8(avatarId),
        $updated_at: TypedValues.utf8(updatedAt),
      },
    ),
  );
}

async function deleteUserAvatar(avatarId: string | null): Promise<void> {
  if (!avatarId) return;

  await withSession((session) =>
    session.executeQuery(
      `
DECLARE $avatar_id AS Utf8;
DELETE FROM ${TABLES.userAvatars}
WHERE avatar_id = $avatar_id;
      `,
      {
        $avatar_id: TypedValues.utf8(avatarId),
      },
    ),
  );
}

function getMockLocalAdminAvatar(): Promise<Buffer> {
  mockLocalAdminAvatar ??= sharp(
    Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="128" fill="#ffc857"/>
  <circle cx="192" cy="62" r="38" fill="#1d151d" opacity="0.16"/>
  <circle cx="72" cy="202" r="52" fill="#1d151d" opacity="0.12"/>
  <text x="128" y="151" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="104" font-weight="800" fill="#1d151d">L</text>
</svg>
    `),
  )
    .webp({ quality: 90 })
    .toBuffer();

  return mockLocalAdminAvatar;
}
