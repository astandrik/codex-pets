import { NextResponse } from "next/server";

import {
  type AuthUser,
  getUserById,
  normalizeProfileSlug,
  updateUserProfile,
} from "@/lib/auth/repository";
import {
  avatarUrlFromId,
  MAX_USER_AVATAR_BYTES,
  processUserAvatarImage,
  storeUserAvatar,
  USER_AVATAR_CONTENT_TYPES,
} from "@/lib/auth/avatar-repository";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_BIO_LENGTH = 280;
const MAX_WEBSITE_URL_LENGTH = 160;

type ProfileRequestBody = {
  displayName?: unknown;
  profileSlug?: unknown;
  bio?: unknown;
  websiteUrl?: unknown;
  githubUrl?: unknown;
  linkedinUrl?: unknown;
};

type ProfileRequestInput = ProfileRequestBody & {
  avatarFile?: FileLike | null;
};

type FileLike = {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export async function PATCH(req: Request): Promise<Response> {
  if (!isYdbConfigured()) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  const principal = await getCurrentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const existing = await getUserById(principal.userId);
  if (!existing) {
    return NextResponse.json(
      {
        error: "profile_not_editable",
        message: "This auth mode does not have an editable local profile.",
      },
      { status: 403 },
    );
  }

  const parsed = await parseProfileRequest(req);
  if (parsed instanceof Response) return parsed;

  const displayName =
    typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
  if (!displayName) {
    return NextResponse.json(
      { error: "invalid_display_name", message: "Display name is required." },
      { status: 400 },
    );
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return NextResponse.json(
      {
        error: "invalid_display_name",
        message: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  const requestedProfileSlug =
    typeof parsed.profileSlug === "string" ? parsed.profileSlug : "";
  const profileSlug = normalizeProfileSlug(requestedProfileSlug);
  if (!profileSlug) {
    return NextResponse.json(
      {
        error: "invalid_profile_slug",
        message:
          "Handle must be 3-40 characters using lowercase letters, numbers, and hyphens.",
      },
      { status: 400 },
    );
  }

  const bio = typeof parsed.bio === "string" ? parsed.bio.trim() : "";
  if (bio.length > MAX_BIO_LENGTH) {
    return NextResponse.json(
      {
        error: "invalid_bio",
        message: `Bio must be ${MAX_BIO_LENGTH} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  const websiteUrl = normalizePublicUrl(parsed.websiteUrl);
  if (websiteUrl === false) {
    return NextResponse.json(
      {
        error: "invalid_website_url",
        message: "Website must be an http or https URL.",
      },
      { status: 400 },
    );
  }

  const githubUrl = normalizePublicUrl(parsed.githubUrl, [
    "github.com",
    "www.github.com",
  ]);
  if (githubUrl === false) {
    return NextResponse.json(
      {
        error: "invalid_github_url",
        message: "GitHub must be an http or https URL on github.com.",
      },
      { status: 400 },
    );
  }

  const linkedinUrl = normalizePublicUrl(parsed.linkedinUrl, [
    "linkedin.com",
    "www.linkedin.com",
  ]);
  if (linkedinUrl === false) {
    return NextResponse.json(
      {
        error: "invalid_linkedin_url",
        message: "LinkedIn must be an http or https URL on linkedin.com.",
      },
      { status: 400 },
    );
  }

  const avatar = parsed.avatarFile
    ? await readAvatarUpload(parsed.avatarFile)
    : null;
  if (avatar instanceof Response) return avatar;

  try {
    const user = await updateUserProfile({
      userId: existing.userId,
      displayName,
      profileSlug,
      bio: bio || null,
      websiteUrl,
      githubUrl,
      linkedinUrl,
    });
    const avatarUrl =
      avatar && user
        ? (
            await storeUserAvatar({
              userId: existing.userId,
              buffer: avatar.buffer,
              sizeBytes: avatar.sizeBytes,
            })
          ).avatarUrl
        : avatarUrlFromId(user?.avatarId ?? null);

    return NextResponse.json({
      ok: true,
      profile: user ? serializeProfile(user, avatarUrl) : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "profile_slug_taken") {
      return NextResponse.json(
        {
          error: "profile_slug_taken",
          message: "That handle is already in use.",
        },
        { status: 409 },
      );
    }

    throw error;
  }
}

async function parseProfileRequest(
  req: Request,
): Promise<ProfileRequestInput | Response> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
    }

    const avatarValue = form.get("avatar");
    return {
      displayName: form.get("displayName"),
      profileSlug: form.get("profileSlug"),
      bio: form.get("bio"),
      websiteUrl: form.get("websiteUrl"),
      githubUrl: form.get("githubUrl"),
      linkedinUrl: form.get("linkedinUrl"),
      avatarFile:
        isFileLike(avatarValue) && avatarValue.size > 0 ? avatarValue : null,
    };
  }

  try {
    return (await req.json()) as ProfileRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}

async function readAvatarUpload(
  file: FileLike,
): Promise<{ buffer: Buffer; sizeBytes: number } | Response> {
  if (!USER_AVATAR_CONTENT_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: "invalid_avatar_type",
        message: "Avatar must be a PNG, JPEG, or WebP image.",
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_USER_AVATAR_BYTES) {
    return NextResponse.json(
      {
        error: "avatar_too_large",
        message: "Avatar image must be 5 MB or smaller.",
      },
      { status: 400 },
    );
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const processed = await processUserAvatarImage({
    buffer: rawBuffer,
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!processed.ok) {
    return NextResponse.json(
      {
        error: processed.error,
        message: processed.message,
      },
      { status: 400 },
    );
  }

  return {
    buffer: processed.buffer,
    sizeBytes: processed.sizeBytes,
  };
}

function isFileLike(value: unknown): value is FileLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    "type" in value
  );
}

function serializeProfile(user: AuthUser, avatarUrl: string | null) {
  return {
    displayName: user.displayName,
    profileSlug: user.profileSlug,
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    githubUrl: user.githubUrl,
    linkedinUrl: user.linkedinUrl,
    avatarUrl,
  };
}

function normalizePublicUrl(
  value: unknown,
  allowedHosts?: string[],
): string | null | false {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length > MAX_WEBSITE_URL_LENGTH) return false;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (allowedHosts && !allowedHosts.includes(url.hostname.toLowerCase())) {
      return false;
    }
    return url.toString();
  } catch {
    return false;
  }
}
