import {
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export async function claimHoldoutRun(markerPath, now = () => new Date()) {
  await mkdir(dirname(markerPath), { recursive: true });
  let file;
  try {
    file = await open(markerPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "The untouched holdout has already run; do not tune or rerun it.",
      );
    }
    throw error;
  }
  try {
    await file.writeFile(
      `${JSON.stringify({
        startedAt: now().toISOString(),
        status: "started",
      }, null, 2)}\n`,
    );
  } finally {
    await file.close();
  }
}

export async function completeHoldoutRun(markerPath, status) {
  const current = JSON.parse(await readFile(markerPath, "utf8"));
  await writeFile(
    markerPath,
    `${JSON.stringify({ ...current, status }, null, 2)}\n`,
    { mode: 0o600 },
  );
}
