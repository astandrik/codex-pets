import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export function readTextHoldoutEnvironment(environment) {
  const markerPath =
    environment.PET_SEARCH_TEXT_HOLDOUT_MARKER_PATH?.trim() ?? "";
  if (!markerPath || !isAbsolute(markerPath)) {
    throw new Error(
      "PET_SEARCH_TEXT_HOLDOUT_MARKER_PATH must be an absolute marker path.",
    );
  }
  const rolloutId = environment.PET_SEARCH_TEXT_HOLDOUT_ROLLOUT_ID?.trim() ?? "";
  if (!rolloutId) {
    throw new Error(
      "PET_SEARCH_TEXT_HOLDOUT_ROLLOUT_ID is required.",
    );
  }
  return { markerPath, rolloutId };
}

export async function claimTextHoldoutRun(
  markerPath,
  rolloutId,
  now = () => new Date(),
) {
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  let file;
  try {
    file = await open(markerPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "The untouched text holdout has already run; do not tune or rerun it.",
      );
    }
    throw error;
  }
  try {
    await file.writeFile(
      `${JSON.stringify(
        { rolloutId, startedAt: now().toISOString(), status: "started" },
        null,
        2,
      )}\n`,
    );
  } finally {
    await file.close();
  }
}

export async function completeTextHoldoutRun(markerPath, rolloutId, status) {
  const current = JSON.parse(await readFile(markerPath, "utf8"));
  if (current.rolloutId !== rolloutId) {
    throw new Error("Text holdout marker rollout identity does not match.");
  }
  await writeFile(
    markerPath,
    `${JSON.stringify({ ...current, status }, null, 2)}\n`,
    { mode: 0o600 },
  );
}
