import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquirePetSearchHoldoutReceipt,
  type PetSearchHoldoutReceiptInput,
} from "@/lib/pets/search-eval-holdout-receipt";

describe("pet search holdout receipt", () => {
  it("creates one immutable receipt bound to all holdout inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pet-search-holdout-"));
    const receiptPath = join(directory, "visual-holdout-v2.json");
    const input = receiptInput(receiptPath);

    try {
      await acquirePetSearchHoldoutReceipt(input);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      const metadata = await stat(receiptPath);

      expect(receipt).toEqual({
        receiptVersion: "codex-pets-visual-holdout-receipt-v1",
        suite: "visual-holdout-v2",
        commitSha: "a".repeat(40),
        captionRevision:
          "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2",
        visualRevision: "yandex-text-search-2026-07-pet-vision-v2",
        profile: { minSemanticScore: 0.72, weight: 0.5 },
        queryManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        judgmentsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        acquiredAt: "2026-07-23T13:30:00.000Z",
      });
      expect(metadata.mode & 0o777).toBe(0o400);
      await expect(acquirePetSearchHoldoutReceipt(input))
        .rejects.toThrow(/already.*acquired/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an unbound or non-absolute receipt before writing", async () => {
    await expect(
      acquirePetSearchHoldoutReceipt({
        ...receiptInput("relative-receipt.json"),
        commitSha: "not-a-commit",
      }),
    ).rejects.toThrow(/commit sha/i);
  });
});

function receiptInput(receiptPath: string): PetSearchHoldoutReceiptInput {
  return {
    receiptPath,
    commitSha: "a".repeat(40),
    captionRevision:
      "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2",
    visualRevision: "yandex-text-search-2026-07-pet-vision-v2",
    profile: { minSemanticScore: 0.72, weight: 0.5 },
    queryManifest: [{ id: "holdout-one", query: "hidden query" }],
    judgments: [{ queryId: "holdout-one", judgments: ["relevant"] }],
    now: () => new Date("2026-07-23T13:30:00.000Z"),
  };
}
