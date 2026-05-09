"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import {
  Alert,
  Button,
  Card,
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
import { PET_SHEET } from "@/lib/pets/types";
import "./SubmitForm.scss";

type PreparedPackage = {
  petJsonBlob: Blob;
  spritesheetBlob: Blob;
  zipBlob: Blob;
  petId: string;
  displayName: string;
  spritesheetExt: "webp" | "png";
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
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [petJsonFile, setPetJsonFile] = useState<File | null>(null);
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [contactEmail, setContactEmail] = useState(defaultContactEmail ?? "");
  const [kind, setKind] = useState("creature");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProgress("Preparing package...");

    try {
      const prepared = zipFile
        ? await prepareFromZip(zipFile)
        : await prepareFromSeparateFiles(petJsonFile, spriteFile);

      setProgress("Uploading package...");
      await submitPetPackage({
        url: withBasePath("/api/submissions/register"),
        prepared,
        contactEmail,
        kind,
        tags,
      });
      trackGoal("pet_submit_success", {
        authenticated: isAuthenticated,
        hasContactEmail: Boolean(contactEmail),
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
                className="submit-form__file"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setZipFile(event.target.files?.[0] ?? null)}
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
                className="submit-form__file"
                type="file"
                accept="application/json,.json"
                onChange={(event) =>
                  setPetJsonFile(event.target.files?.[0] ?? null)
                }
              />
            </FieldRow>
            <FieldRow label="spritesheet" htmlFor="submit-sprite">
              <input
                id="submit-sprite"
                className="submit-form__file"
                type="file"
                accept="image/webp,image/png,.webp,.png"
                onChange={(event) =>
                  setSpriteFile(event.target.files?.[0] ?? null)
                }
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
                  onUpdate={setContactEmail}
                  placeholder="optional@email.com"
                  autoComplete="email"
                  size="l"
                  hasClear
                />
              </FieldRow>
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

async function prepareFromZip(file: File): Promise<PreparedPackage> {
  const zip = await JSZip.loadAsync(file);
  const petJsonEntry = zip.file("pet.json");
  if (!petJsonEntry) throw new Error("ZIP must contain pet.json at the root.");

  const petJsonText = await petJsonEntry.async("string");
  const petJson = parseClientPetJson(petJsonText);
  const ext = spriteExtFromPath(petJson.spritesheetPath);
  const spriteEntry = zip.file(`spritesheet.${ext}`);
  if (!spriteEntry) {
    throw new Error(`ZIP must contain spritesheet.${ext} at the root.`);
  }

  const spriteBlob = await spriteEntry.async("blob");
  await validateImageDimensions(spriteBlob);

  return {
    petJsonBlob: new Blob([petJsonText], { type: "application/json" }),
    spritesheetBlob: spriteBlob,
    zipBlob: file,
    petId: petJson.id,
    displayName: petJson.displayName,
    spritesheetExt: ext,
  };
}

async function prepareFromSeparateFiles(
  petJsonFile: File | null,
  spriteFile: File | null,
): Promise<PreparedPackage> {
  if (!petJsonFile || !spriteFile) {
    throw new Error("Choose a ZIP or both pet.json and spritesheet.");
  }

  const petJsonText = await petJsonFile.text();
  const petJson = parseClientPetJson(petJsonText);
  const ext = spriteExtFromPath(petJson.spritesheetPath);
  if (!spriteFile.name.endsWith(`.${ext}`)) {
    throw new Error(`Sprite file must match ${petJson.spritesheetPath}.`);
  }
  await validateImageDimensions(spriteFile);

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
    petId: petJson.id,
    displayName: petJson.displayName,
    spritesheetExt: ext,
  };
}

function parseClientPetJson(text: string): {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
} {
  const value = JSON.parse(text) as Record<string, unknown>;
  for (const key of ["id", "displayName", "description", "spritesheetPath"]) {
    if (typeof value[key] !== "string" || !value[key]) {
      throw new Error(`pet.json is missing ${key}.`);
    }
  }
  return value as {
    id: string;
    displayName: string;
    description: string;
    spritesheetPath: string;
  };
}

function spriteExtFromPath(path: string): "webp" | "png" {
  if (path === "spritesheet.webp") return "webp";
  if (path === "spritesheet.png") return "png";
  throw new Error("spritesheetPath must be spritesheet.webp or spritesheet.png.");
}

function validateImageDimensions(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.width !== PET_SHEET.width || image.height !== PET_SHEET.height) {
        reject(
          new Error(
            `Spritesheet must be ${PET_SHEET.width}x${PET_SHEET.height}; got ${image.width}x${image.height}.`,
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
