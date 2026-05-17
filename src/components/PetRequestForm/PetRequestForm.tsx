"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Flex,
  Select,
  Text,
  TextArea,
  TextInput,
  useToaster,
} from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import "./PetRequestForm.scss";

type PetRequestFormProps = {
  defaultContactEmail?: string | null;
  defaultRequesterName?: string | null;
};

const KIND_OPTIONS = [
  { value: "creature", content: "Creature" },
  { value: "object", content: "Object" },
  { value: "character", content: "Character" },
];
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function PetRequestForm({
  defaultContactEmail = null,
  defaultRequesterName = null,
}: PetRequestFormProps) {
  const { add } = useToaster();
  const [contactEmail, setContactEmail] = useState(defaultContactEmail ?? "");
  const [requesterName, setRequesterName] = useState(defaultRequesterName ?? "");
  const [displayNameHint, setDisplayNameHint] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("creature");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const referenceImagePreviewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (referenceImagePreviewRef.current) {
        URL.revokeObjectURL(referenceImagePreviewRef.current);
      }
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const body = createRequestBody({
        contactEmail,
        requesterName,
        displayNameHint,
        prompt,
        kind,
        referenceImage,
      });
      const response = await fetch(withBasePath("/api/generation-requests"), {
        method: "POST",
        headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
        body,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(
          data.message ?? data.error ?? `Request failed ${response.status}`,
        );
      }

      trackGoal("pet_generation_request_success", {
        kind,
        hasName: Boolean(requesterName.trim()),
        hasDisplayNameHint: Boolean(displayNameHint.trim()),
        hasReferenceImage: Boolean(referenceImage),
      });
      setSuccess("Request received. An admin will review it from the queue.");
      setDisplayNameHint("");
      setPrompt("");
      clearReferenceImage();
      add({
        name: "pet-request-success",
        theme: "success",
        title: "Request received",
      });
    } catch (err) {
      trackGoal("pet_generation_request_error", { kind });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onReferenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    setSuccess(null);
    if (!file) {
      setReferenceImageFile(null);
      return;
    }
    const validationError = validateReferenceImage(file);
    if (validationError) {
      setReferenceImageFile(null);
      event.target.value = "";
      setError(validationError);
      return;
    }
    setReferenceImageFile(file);
  }

  function clearReferenceImage() {
    setReferenceImageFile(null);
    if (referenceImageInputRef.current) {
      referenceImageInputRef.current.value = "";
    }
  }

  function setReferenceImageFile(file: File | null) {
    if (referenceImagePreviewRef.current) {
      URL.revokeObjectURL(referenceImagePreviewRef.current);
    }
    const preview = file ? URL.createObjectURL(file) : null;
    referenceImagePreviewRef.current = preview;
    setReferenceImage(file);
    setReferenceImagePreview(preview);
  }

  return (
    <Card view="raised" className="pet-request-form">
      <form onSubmit={onSubmit}>
        <fieldset className="pet-request-form__fieldset" disabled={busy}>
          {error ? (
            <Alert
              theme="danger"
              title="Request failed"
              message={error}
              onClose={() => setError(null)}
            />
          ) : null}
          {success ? (
            <Alert
              theme="success"
              title="Request submitted"
              message={success}
              onClose={() => setSuccess(null)}
            />
          ) : null}

          <Flex direction="column" gap={3}>
            <Text variant="subheader-2" as="h2">
              Contact
            </Text>
            <FieldRow label="Contact email" htmlFor="request-email">
              <TextInput
                id="request-email"
                value={contactEmail}
                onUpdate={setContactEmail}
                placeholder="you@example.com"
                autoComplete="email"
                size="l"
                hasClear
              />
            </FieldRow>
            <FieldRow label="Your name" htmlFor="request-name">
              <TextInput
                id="request-name"
                value={requesterName}
                onUpdate={setRequesterName}
                placeholder="Optional"
                autoComplete="name"
                size="l"
                hasClear
              />
            </FieldRow>
          </Flex>

          <Flex direction="column" gap={3}>
            <Text variant="subheader-2" as="h2">
              Pet request
            </Text>
            <FieldRow label="Display name idea" htmlFor="request-display-name">
              <TextInput
                id="request-display-name"
                value={displayNameHint}
                onUpdate={setDisplayNameHint}
                placeholder="Optional"
                size="l"
                hasClear
              />
            </FieldRow>
            <FieldRow label="Kind" htmlFor="request-kind">
              <Select
                id="request-kind"
                value={[kind]}
                onUpdate={(values) => setKind(values[0] ?? "creature")}
                options={KIND_OPTIONS}
                size="l"
                width="max"
              />
            </FieldRow>
            <FieldRow
              label="Prompt"
              htmlFor="request-prompt"
              note="Describe the character, object, mood, colors, and any must-have details."
            >
              <TextArea
                id="request-prompt"
                value={prompt}
                onUpdate={setPrompt}
                placeholder="A compact desk companion with calm idle animation and bright review state..."
                size="l"
                minRows={6}
                maxRows={12}
              />
            </FieldRow>
            <FieldRow
              label="Reference image"
              htmlFor="request-reference-image"
              note="Optional PNG, JPEG, or WebP image up to 5 MB."
            >
              <input
                ref={referenceImageInputRef}
                id="request-reference-image"
                className="pet-request-form__file"
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={onReferenceImageChange}
              />
              {referenceImage && referenceImagePreview ? (
                <Flex
                  gap={3}
                  alignItems="center"
                  className="pet-request-form__reference"
                >
                  <span
                    aria-hidden="true"
                    className="pet-request-form__reference-image"
                    style={{ backgroundImage: `url("${referenceImagePreview}")` }}
                  />
                  <Flex direction="column" gap={1} className="pet-request-form__reference-meta">
                    <Text variant="body-2">{referenceImage.name}</Text>
                    <Text variant="caption-2" color="secondary">
                      {formatFileSize(referenceImage.size)}
                    </Text>
                    <Button view="flat-danger" size="s" onClick={clearReferenceImage}>
                      Remove
                    </Button>
                  </Flex>
                </Flex>
              ) : null}
            </FieldRow>
          </Flex>

          <Flex justifyContent="flex-end">
            <Button
              view="action"
              size="l"
              type="submit"
              loading={busy}
              disabled={!contactEmail.trim() || !prompt.trim()}
            >
              Request pet
            </Button>
          </Flex>
        </fieldset>
      </form>
    </Card>
  );
}

function createRequestBody(input: {
  contactEmail: string;
  requesterName: string;
  displayNameHint: string;
  prompt: string;
  kind: string;
  referenceImage: File | null;
}): BodyInit {
  if (!input.referenceImage) {
    return JSON.stringify({
      contactEmail: input.contactEmail,
      requesterName: input.requesterName,
      displayNameHint: input.displayNameHint,
      prompt: input.prompt,
      kind: input.kind,
    });
  }

  const formData = new FormData();
  formData.set("contactEmail", input.contactEmail);
  formData.set("requesterName", input.requesterName);
  formData.set("displayNameHint", input.displayNameHint);
  formData.set("prompt", input.prompt);
  formData.set("kind", input.kind);
  formData.set("referenceImage", input.referenceImage);
  return formData;
}

function validateReferenceImage(file: File): string | null {
  if (!REFERENCE_IMAGE_TYPES.has(file.type)) {
    return "Reference image must be PNG, JPEG, or WebP.";
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return "Reference image must be 5 MB or less.";
  }
  return null;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

type FieldRowProps = {
  label: string;
  htmlFor: string;
  note?: string;
  children: React.ReactNode;
};

function FieldRow({ label, htmlFor, note, children }: FieldRowProps) {
  return (
    <Flex direction="column" gap={1} className="pet-request-form__field">
      <label className="pet-request-form__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {note ? (
        <Text variant="caption-2" color="secondary">
          {note}
        </Text>
      ) : null}
    </Flex>
  );
}
