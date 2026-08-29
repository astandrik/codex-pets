"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Select,
  Text,
  TextArea,
  TextInput,
  useToaster,
} from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import {
  derivePublicAuthorNameFromEmail,
  MAX_PUBLIC_AUTHOR_NAME_LENGTH,
} from "@/lib/pets/author-attribution";
import {
  getPetSheet,
  type SpriteVersionNumber,
} from "@/lib/pets/types";
import {
  parseEditablePetJson,
  readOriginalPetJsonId,
  type SubmitPetJson,
  type SubmitSpriteExt,
} from "./pet-json-editor";
import "./SubmitForm.scss";

type PreparedPackage = {
  petJsonBlob: Blob;
  spritesheetBlob: Blob;
  zipBlob: Blob;
  petId: string;
  displayName: string;
  spritesheetExt: SubmitSpriteExt;
};

type SubmitFormProps = {
  isAuthenticated: boolean;
  defaultContactEmail?: string | null;
};

const KIND_OPTIONS = [
  { value: "creature", content: "Creature" },
  { value: "object", content: "Object" },
  { value: "character", content: "Character" },
];

export function SubmitForm({
  isAuthenticated,
  defaultContactEmail = null,
}: SubmitFormProps) {
  const router = useRouter();
  const { add } = useToaster();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const petJsonInputRef = useRef<HTMLInputElement>(null);
  const spriteInputRef = useRef<HTMLInputElement>(null);
  const petJsonLoadIdRef = useRef(0);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [petJsonFile, setPetJsonFile] = useState<File | null>(null);
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [petJsonText, setPetJsonText] = useState("");
  const [originalPetId, setOriginalPetId] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState(defaultContactEmail ?? "");
  const [publicAuthorName, setPublicAuthorName] = useState(
    derivePublicAuthorNameFromEmail(defaultContactEmail ?? "") ?? "",
  );
  const [publishContactEmail, setPublishContactEmail] = useState(false);
  const [kind, setKind] = useState("creature");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveContactEmail = isAuthenticated
    ? defaultContactEmail?.trim() ?? ""
    : contactEmail.trim();

  function updateContactEmail(value: string) {
    const previousDerivedName = derivePublicAuthorNameFromEmail(contactEmail);
    const nextDerivedName = derivePublicAuthorNameFromEmail(value) ?? "";
    setContactEmail(value);
    if (!value.trim()) {
      setPublicAuthorName("");
      setPublishContactEmail(false);
      return;
    }
    setPublicAuthorName((current) =>
      !current || current === previousDerivedName ? nextDerivedName : current,
    );
  }

  async function onZipFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setZipFile(file);
    setPetJsonFile(null);
    setSpriteFile(null);
    clearFileInput(petJsonInputRef);
    clearFileInput(spriteInputRef);
    await loadPetJsonText(file ? () => readPetJsonTextFromZip(file) : null);
  }

  async function onPetJsonFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPetJsonFile(file);
    setZipFile(null);
    clearFileInput(zipInputRef);
    await loadPetJsonText(file ? () => file.text() : null);
  }

  function onSpriteFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSpriteFile(file);
    setZipFile(null);
    clearFileInput(zipInputRef);
    setError(null);
    setProgress(null);
  }

  async function loadPetJsonText(readText: (() => Promise<string>) | null) {
    const loadId = ++petJsonLoadIdRef.current;

    setError(null);
    setProgress(null);
    setPetJsonText("");
    setOriginalPetId(null);

    if (!readText) {
      return;
    }

    try {
      const text = await readText();
      if (loadId !== petJsonLoadIdRef.current) return;

      setPetJsonText(text);
      setOriginalPetId(readOriginalPetJsonId(text));
    } catch (err) {
      if (loadId !== petJsonLoadIdRef.current) return;

      const msg = err instanceof Error ? err.message : String(err);
      setPetJsonText("");
      setOriginalPetId(null);
      setError(msg);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProgress("Preparing package...");

    try {
      const prepared = zipFile
        ? await prepareFromZip(zipFile, petJsonText, originalPetId)
        : await prepareFromSeparateFiles(
            petJsonFile,
            spriteFile,
            petJsonText,
            originalPetId,
          );

      setProgress("Uploading package...");
      await submitPetPackage({
        url: withBasePath("/api/submissions/register"),
        prepared,
        contactEmail,
        publicAuthorName,
        publishContactEmail,
        kind,
        tags,
      });
      trackGoal("pet_submit_success", {
        authenticated: isAuthenticated,
        hasContactEmail: Boolean(contactEmail),
        publishesContactEmail: publishContactEmail,
        kind,
      });

      add({
        name: "pet-submit-success",
        theme: "success",
        title: `${prepared.displayName} submitted`,
        content: "Your pet is now pending review.",
      });

      if (isAuthenticated) {
        router.push("/my-pets");
        router.refresh();
      } else {
        setProgress(`${prepared.displayName} is pending review.`);
      }
    } catch (err) {
      trackGoal("pet_submit_error", {
        authenticated: isAuthenticated,
        kind,
      });
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card view="raised" className="submit-form">
      <form onSubmit={onSubmit}>
        <fieldset className="submit-form__fieldset" disabled={busy}>
          {error ? (
            <Alert
              theme="danger"
              title="Submission failed"
              message={error}
              onClose={() => setError(null)}
            />
          ) : null}

          <Flex direction="column" gap={3}>
            <Text variant="subheader-2" as="h2">
              Upload package
            </Text>
            <FieldRow label="ZIP package" htmlFor="submit-zip">
              <input
                id="submit-zip"
                ref={zipInputRef}
                className="submit-form__file"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => void onZipFileChange(event)}
              />
            </FieldRow>

            <Flex
              alignItems="center"
              gap={3}
              className="submit-form__divider-row"
            >
              <Divider orientation="horizontal" className="submit-form__divider-line" />
              <Text variant="caption-2" color="secondary">
                or upload files separately
              </Text>
              <Divider orientation="horizontal" className="submit-form__divider-line" />
            </Flex>

            <FieldRow label="pet.json" htmlFor="submit-petjson">
              <input
                id="submit-petjson"
                ref={petJsonInputRef}
                className="submit-form__file"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void onPetJsonFileChange(event)}
              />
            </FieldRow>
            <FieldRow label="spritesheet" htmlFor="submit-sprite">
              <input
                id="submit-sprite"
                ref={spriteInputRef}
                className="submit-form__file"
                type="file"
                accept="image/webp,image/png,.webp,.png"
                onChange={onSpriteFileChange}
              />
            </FieldRow>
            <FieldRow
              label="pet.json editor"
              htmlFor="submit-petjson-editor"
              note="Edit the uploaded pet.json before review. If it already has an id, keep it unchanged."
            >
              <TextArea
                id="submit-petjson-editor"
                value={petJsonText}
                onUpdate={setPetJsonText}
                placeholder='{"id":"demo","displayName":"Demo","description":"Demo pet","spritesheetPath":"spritesheet.webp"}'
                size="l"
                minRows={10}
                className="submit-form__json-editor"
              />
            </FieldRow>
          </Flex>

          <Divider orientation="horizontal" />

          <Flex direction="column" gap={3}>
            <Text variant="subheader-2" as="h2">
              Metadata
            </Text>
            {!isAuthenticated ? (
              <FieldRow label="Contact email" htmlFor="submit-email">
                <TextInput
                  id="submit-email"
                  value={contactEmail}
                  onUpdate={updateContactEmail}
                  placeholder="optional@email.com"
                  autoComplete="email"
                  size="l"
                  hasClear
                />
              </FieldRow>
            ) : null}
            {!isAuthenticated && effectiveContactEmail ? (
              <FieldRow
                label="Public author name"
                htmlFor="submit-public-author-name"
                note="Shown publicly as the pet author. It defaults to the part of your email before @."
              >
                <TextInput
                  id="submit-public-author-name"
                  value={publicAuthorName}
                  onUpdate={setPublicAuthorName}
                  controlProps={{
                    maxLength: MAX_PUBLIC_AUTHOR_NAME_LENGTH,
                    required: true,
                  }}
                  size="l"
                  hasClear
                />
              </FieldRow>
            ) : null}
            {effectiveContactEmail ? (
              <Checkbox
                checked={publishContactEmail}
                onUpdate={setPublishContactEmail}
                size="l"
                content={
                  <Flex direction="column" gap={1}>
                    <Text variant="body-2">
                      Request publication of {effectiveContactEmail}
                    </Text>
                    <Text variant="caption-2" color="secondary">
                      After moderator verification, the full email will appear
                      on public pages, APIs, manifests, MCP, JSON-LD, and LLM
                      resources.
                    </Text>
                  </Flex>
                }
              />
            ) : null}
            <FieldRow label="Kind" htmlFor="submit-kind">
              <Select
                id="submit-kind"
                value={[kind]}
                onUpdate={(values) => setKind(values[0] ?? "creature")}
                options={KIND_OPTIONS}
                size="l"
                width="max"
              />
            </FieldRow>
            <FieldRow
              label="Tags"
              htmlFor="submit-tags"
              note="Comma-separated keywords."
            >
              <TextArea
                id="submit-tags"
                value={tags}
                onUpdate={setTags}
                placeholder="cozy, focused, robot"
                size="l"
                minRows={2}
              />
            </FieldRow>
          </Flex>

          <Flex justifyContent="flex-end" gap={3} alignItems="center">
            {progress ? (
              <Text variant="body-2" color="secondary">
                {progress}
              </Text>
            ) : null}
            <Button view="action" size="l" type="submit" loading={busy}>
              Submit for review
            </Button>
          </Flex>
        </fieldset>
      </form>
    </Card>
  );
}

type FieldRowProps = {
  label: string;
  htmlFor: string;
  note?: string;
  children: React.ReactNode;
};

function FieldRow({ label, htmlFor, note, children }: FieldRowProps) {
  return (
    <Flex direction="column" gap={1} className="submit-form__field">
      <label className="submit-form__label" htmlFor={htmlFor}>
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

async function prepareFromZip(
  file: File,
  petJsonText: string,
  originalPetId: string | null,
): Promise<PreparedPackage> {
  const zip = await JSZip.loadAsync(file);
  const petJsonEntry = zip.file("pet.json");
  if (!petJsonEntry) throw new Error("ZIP must contain pet.json at the root.");

  const editedPetJson = parseEditedPetJson(petJsonText, originalPetId);
  const ext = editedPetJson.spritesheetExt;
  const spriteEntry = zip.file(`spritesheet.${ext}`);
  if (!spriteEntry) {
    throw new Error(`ZIP must contain spritesheet.${ext} at the root.`);
  }

  const spriteBlob = await spriteEntry.async("blob");
  await validateImageDimensions(
    spriteBlob,
    editedPetJson.petJson.spriteVersionNumber,
  );
  zip.file("pet.json", petJsonText);
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });

  return {
    petJsonBlob: new Blob([petJsonText], { type: "application/json" }),
    spritesheetBlob: spriteBlob,
    zipBlob,
    petId: editedPetJson.petJson.id,
    displayName: editedPetJson.petJson.displayName,
    spritesheetExt: ext,
  };
}

async function prepareFromSeparateFiles(
  petJsonFile: File | null,
  spriteFile: File | null,
  petJsonText: string,
  originalPetId: string | null,
): Promise<PreparedPackage> {
  if (!petJsonFile || !spriteFile) {
    throw new Error("Choose a ZIP or both pet.json and spritesheet.");
  }

  const editedPetJson = parseEditedPetJson(petJsonText, originalPetId);
  const ext = editedPetJson.spritesheetExt;
  if (!spriteFile.name.toLowerCase().endsWith(`.${ext}`)) {
    throw new Error(`Sprite file must match ${editedPetJson.petJson.spritesheetPath}.`);
  }
  await validateImageDimensions(
    spriteFile,
    editedPetJson.petJson.spriteVersionNumber,
  );

  const zip = new JSZip();
  zip.file("pet.json", petJsonText);
  zip.file(`spritesheet.${ext}`, spriteFile);
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });

  return {
    petJsonBlob: new Blob([petJsonText], { type: "application/json" }),
    spritesheetBlob: spriteFile,
    zipBlob,
    petId: editedPetJson.petJson.id,
    displayName: editedPetJson.petJson.displayName,
    spritesheetExt: ext,
  };
}

function parseEditedPetJson(
  text: string,
  originalId: string | null,
): {
  petJson: SubmitPetJson;
  spritesheetExt: SubmitSpriteExt;
} {
  const result = parseEditablePetJson({ text, originalId });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function readPetJsonTextFromZip(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const petJsonEntry = zip.file("pet.json");
  if (!petJsonEntry) throw new Error("ZIP must contain pet.json at the root.");
  return petJsonEntry.async("string");
}

function clearFileInput(ref: React.RefObject<HTMLInputElement | null>) {
  if (ref.current) ref.current.value = "";
}

function validateImageDimensions(
  blob: Blob,
  spriteVersionNumber?: SpriteVersionNumber,
): Promise<void> {
  const sheet = getPetSheet(spriteVersionNumber);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.width !== sheet.width || image.height !== sheet.height) {
        reject(
          new Error(
            `Spritesheet must be ${sheet.width}x${sheet.height}; got ${image.width}x${image.height}.`,
          ),
        );
        return;
      }
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read spritesheet image."));
    };
    image.src = url;
  });
}

async function submitPetPackage(input: {
  url: string;
  prepared: PreparedPackage;
  contactEmail: string;
  publicAuthorName: string;
  publishContactEmail: boolean;
  kind: string;
  tags: string;
}): Promise<void> {
  const formData = new FormData();
  formData.set("zip", input.prepared.zipBlob, "pet.zip");
  formData.set("petjson", input.prepared.petJsonBlob, "pet.json");
  formData.set(
    "sprite",
    input.prepared.spritesheetBlob,
    `spritesheet.${input.prepared.spritesheetExt}`,
  );
  formData.set("kind", input.kind);
  formData.set("tags", input.tags);
  formData.set("contactEmail", input.contactEmail);
  formData.set("publicAuthorName", input.publicAuthorName);
  formData.set("publishContactEmail", String(input.publishContactEmail));
  formData.set("petIdHint", input.prepared.petId);
  formData.set("spritesheetExt", input.prepared.spritesheetExt);

  const response = await fetch(input.url, {
    method: "POST",
    body: formData,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Upload failed ${response.status}`);
  }
}
