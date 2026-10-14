import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { petModerationPaused } from "@/lib/pets/moderation-pause";
import { POST as approve } from "@/app/api/admin/submissions/[id]/approve/route";
import { POST as reject } from "@/app/api/admin/submissions/[id]/reject/route";
import { POST as adminDelete } from "@/app/api/admin/submissions/[id]/delete/route";
import { POST as ownerDelete } from "@/app/api/my-pets/[id]/delete/route";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getCurrentPrincipal: auth, isAdminUser: vi.fn() }));
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); directories.splice(0).forEach((p) => rmSync(p, { recursive: true })); auth.mockClear(); });
describe("short moderation cutover gate", () => {
  it("leaves existing behavior unchanged without a gate and fails closed with unreadable config", () => {
    expect(petModerationPaused({})).toBe(false);
    expect(petModerationPaused({ PET_MODERATION_PAUSE_FILE: "gate" }, () => "false\n")).toBe(false);
    expect(petModerationPaused({ PET_MODERATION_PAUSE_FILE: "gate" }, () => "true")).toBe(true);
    expect(petModerationPaused({ PET_MODERATION_PAUSE_FILE: "gate" }, () => { throw new Error("gone"); })).toBe(true);
  });
  it.each([approve, reject, adminDelete, ownerDelete])("blocks a catalog mutation before data or auth access", async (post) => {
    const directory = mkdtempSync(join(tmpdir(), "pets-moderation-gate-")); directories.push(directory);
    const file = join(directory, "paused"); writeFileSync(file, "true"); vi.stubEnv("PET_MODERATION_PAUSE_FILE", file);
    const response = await post(new Request("https://pets.example/api/admin/submissions/synthetic/approve", { method: "POST" }), { params: Promise.resolve({ id: "synthetic" }) });
    expect(response.status).toBe(503); expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({ error: "moderation_paused" }); expect(auth).not.toHaveBeenCalled();
  });
});
