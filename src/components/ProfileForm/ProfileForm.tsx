"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Flex,
  Text,
  TextArea,
  TextInput,
} from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import "./ProfileForm.scss";

type ProfileFormProps = {
  email: string;
  displayName: string;
  profileSlug: string;
  bio: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
};

type ProfileResponse = {
  ok: true;
  profile: {
    displayName: string;
    profileSlug: string;
    bio: string | null;
    websiteUrl: string | null;
    githubUrl: string | null;
    linkedinUrl: string | null;
    avatarUrl: string | null;
  } | null;
};

type DeleteAvatarResponse = {
  ok: true;
  profile: {
    avatarUrl: string | null;
  };
};

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function ProfileForm({
  email,
  displayName: initialDisplayName,
  profileSlug: initialProfileSlug,
  bio: initialBio,
  websiteUrl: initialWebsiteUrl,
  githubUrl: initialGithubUrl,
  linkedinUrl: initialLinkedinUrl,
  avatarUrl: initialAvatarUrl,
}: ProfileFormProps) {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [profileSlug, setProfileSlug] = useState(initialProfileSlug);
  const [bio, setBio] = useState(initialBio ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initialWebsiteUrl ?? "");
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedinUrl ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const avatarDisplayUrl = avatarPreviewUrl ?? avatarUrl;
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "U";

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = avatarFile
        ? await postForm<ProfileResponse>(
            withBasePath("/api/auth/profile"),
            createProfileFormData({
              displayName,
              profileSlug,
              bio,
              websiteUrl,
              githubUrl,
              linkedinUrl,
              avatarFile,
            }),
          )
        : await postJson<ProfileResponse>(
            withBasePath("/api/auth/profile"),
            {
              displayName,
              profileSlug,
              bio,
              websiteUrl,
              githubUrl,
              linkedinUrl,
            },
          );

      if (response.profile) {
        setDisplayName(response.profile.displayName);
        setProfileSlug(response.profile.profileSlug);
        setBio(response.profile.bio ?? "");
        setWebsiteUrl(response.profile.websiteUrl ?? "");
        setGithubUrl(response.profile.githubUrl ?? "");
        setLinkedinUrl(response.profile.linkedinUrl ?? "");
        setAvatarUrl(response.profile.avatarUrl);
        clearAvatarSelection();
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    setError(null);
    setSaved(false);

    if (!file) {
      clearAvatarSelection();
      return;
    }

    if (!AVATAR_CONTENT_TYPES.has(file.type)) {
      clearAvatarSelection();
      setError("Avatar must be a PNG, JPEG, or WebP image.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      clearAvatarSelection();
      setError("Avatar image must be 5 MB or smaller.");
      return;
    }

    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  }

  async function onRemoveAvatar() {
    const hadSavedAvatar = Boolean(avatarUrl);
    clearAvatarSelection();
    if (!hadSavedAvatar) return;

    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await deleteJson<DeleteAvatarResponse>(
        withBasePath("/api/auth/profile/avatar"),
      );
      setAvatarUrl(response.profile.avatarUrl);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function clearAvatarSelection() {
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  }

  return (
    <Card view="raised" className="profile-form">
      <form onSubmit={onSubmit}>
        <fieldset className="profile-form__fieldset" disabled={busy}>
          {error ? (
            <Alert
              theme="danger"
              title="Profile update failed"
              message={error}
              onClose={() => setError(null)}
            />
          ) : null}
          {saved ? (
            <Alert
              theme="success"
              title="Profile saved"
              message="Your public profile has been updated."
              onClose={() => setSaved(false)}
            />
          ) : null}

          <Flex direction="column" gap={1}>
            <Text variant="caption-2" color="secondary">
              Account email
            </Text>
            <Text variant="body-2">{email}</Text>
          </Flex>

          <div className="profile-form__avatar-row">
            <div className="profile-form__avatar" aria-hidden>
              {avatarDisplayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarDisplayUrl} alt="" />
              ) : (
                <span>{avatarInitial}</span>
              )}
            </div>
            <Flex direction="column" gap={2} className="profile-form__avatar-copy">
              <Text variant="subheader-2">Avatar</Text>
              <Text variant="caption-2" color="secondary">
                PNG, JPEG, or WebP. Images are cropped to a square and saved as
                WebP.
              </Text>
              <Flex gap={2} wrap alignItems="center">
                <input
                  ref={avatarInputRef}
                  id="profile-avatar"
                  className="profile-form__file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onAvatarChange}
                />
                {avatarDisplayUrl ? (
                  <Button
                    view="outlined-danger"
                    type="button"
                    onClick={onRemoveAvatar}
                    disabled={busy}
                  >
                    Remove avatar
                  </Button>
                ) : null}
              </Flex>
            </Flex>
          </div>

          <Field label="Display name" htmlFor="profile-display-name">
            <TextInput
              id="profile-display-name"
              value={displayName}
              onUpdate={setDisplayName}
              size="l"
              autoComplete="name"
              hasClear
            />
          </Field>

          <Field label="Handle" htmlFor="profile-handle">
            <TextInput
              id="profile-handle"
              value={profileSlug}
              onUpdate={setProfileSlug}
              size="l"
              autoComplete="username"
              hasClear
            />
          </Field>

          <Field label="Bio" htmlFor="profile-bio">
            <TextArea
              id="profile-bio"
              value={bio}
              onUpdate={setBio}
              minRows={3}
              maxRows={6}
              size="l"
            />
          </Field>

          <Field label="Website" htmlFor="profile-website">
            <TextInput
              id="profile-website"
              value={websiteUrl}
              onUpdate={setWebsiteUrl}
              size="l"
              placeholder="https://example.com"
              autoComplete="url"
              hasClear
            />
          </Field>

          <Field label="GitHub" htmlFor="profile-github">
            <TextInput
              id="profile-github"
              value={githubUrl}
              onUpdate={setGithubUrl}
              size="l"
              placeholder="https://github.com/username"
              autoComplete="url"
              hasClear
            />
          </Field>

          <Field label="LinkedIn" htmlFor="profile-linkedin">
            <TextInput
              id="profile-linkedin"
              value={linkedinUrl}
              onUpdate={setLinkedinUrl}
              size="l"
              placeholder="https://www.linkedin.com/in/username"
              autoComplete="url"
              hasClear
            />
          </Field>

          <Flex gap={2} wrap>
            <Button view="action" size="l" type="submit" loading={busy}>
              Save profile
            </Button>
            <Button
              view="outlined"
              size="l"
              href={withBasePath(`/users/${profileSlug}`)}
            >
              View public page
            </Button>
          </Flex>
        </fieldset>
      </form>
    </Card>
  );
}

type FieldProps = {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
};

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <Flex direction="column" gap={1}>
      <label className="profile-form__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </Flex>
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed ${response.status}`);
  }
  return data as T;
}

async function postForm<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed ${response.status}`);
  }
  return data as T;
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE" });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed ${response.status}`);
  }
  return data as T;
}

function createProfileFormData(input: {
  displayName: string;
  profileSlug: string;
  bio: string;
  websiteUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  avatarFile: File;
}): FormData {
  const form = new FormData();
  form.set("displayName", input.displayName);
  form.set("profileSlug", input.profileSlug);
  form.set("bio", input.bio);
  form.set("websiteUrl", input.websiteUrl);
  form.set("githubUrl", input.githubUrl);
  form.set("linkedinUrl", input.linkedinUrl);
  form.set("avatar", input.avatarFile);
  return form;
}
