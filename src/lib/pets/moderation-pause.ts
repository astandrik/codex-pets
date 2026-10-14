import { readFileSync } from "node:fs";

export function petModerationPaused(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): boolean {
  const file = environment.PET_MODERATION_PAUSE_FILE?.trim();
  if (!file) return false;
  try {
    // An unreadable or invalid configured gate must not open writes during cutover.
    return readText(file).trim() !== "false";
  } catch { return true; }
}

export function petModerationPauseResponse(): Response | null {
  return petModerationPaused() ? Response.json({ error: "moderation_paused" }, {
    status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" },
  }) : null;
}
