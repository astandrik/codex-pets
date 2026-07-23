import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { PetVisualCalibrationProfile } from "@/lib/pets/search-config";

export const PET_SEARCH_HOLDOUT_RECEIPT_VERSION =
  "codex-pets-visual-holdout-receipt-v1";

export type PetSearchHoldoutReceiptInput = {
  receiptPath: string;
  commitSha: string;
  captionRevision: string;
  visualRevision: string;
  profile: PetVisualCalibrationProfile;
  queryManifest: readonly unknown[];
  judgments: readonly unknown[];
  now?: () => Date;
};

export async function acquirePetSearchHoldoutReceipt(
  input: PetSearchHoldoutReceiptInput,
): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(input.commitSha)) {
    throw new Error("Holdout receipt requires an exact lowercase commit SHA.");
  }
  if (!isAbsolute(input.receiptPath)) {
    throw new Error("Holdout receipt path must be absolute.");
  }
  if (!input.captionRevision || !input.visualRevision) {
    throw new Error("Holdout receipt requires bound model revisions.");
  }
  if (
    !Number.isFinite(input.profile.minSemanticScore) ||
    !Number.isFinite(input.profile.weight) ||
    input.profile.weight <= 0
  ) {
    throw new Error("Holdout receipt requires a valid calibration profile.");
  }

  const receipt = {
    receiptVersion: PET_SEARCH_HOLDOUT_RECEIPT_VERSION,
    suite: "visual-holdout-v2" as const,
    commitSha: input.commitSha,
    captionRevision: input.captionRevision,
    visualRevision: input.visualRevision,
    profile: {
      minSemanticScore: input.profile.minSemanticScore,
      weight: input.profile.weight,
    },
    queryManifestHash: hashCanonicalJson(input.queryManifest),
    judgmentsHash: hashCanonicalJson(input.judgments),
    acquiredAt: (input.now?.() ?? new Date()).toISOString(),
  };

  let handle;
  try {
    handle = await open(input.receiptPath, "wx", 0o400);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error("Visual holdout has already been acquired.");
    }
    throw error;
  }

  try {
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Holdout receipt inputs must contain finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      )
      .join(",")}}`;
  }
  throw new Error("Holdout receipt inputs must be JSON-compatible.");
}
