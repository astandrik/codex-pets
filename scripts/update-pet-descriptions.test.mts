import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  MAX_DESCRIPTION_LENGTH,
  assertAllDescriptionsChanged,
  assertAllSlugsFound,
  buildEmbeddingBackfillCommands,
  parseUpdateArgs,
  readDescriptionUpdates,
} = await import("./lib/pet-description-update.mjs");
const {
  RELATED_PETS_REBUILD_COMMANDS,
  buildRelatedPetsDerivedBackfillCommands,
} = await import(
  "./lib/related-pets-maintenance.mjs"
);

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "pet-descriptions-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeUpdates(payload: unknown): string {
  const filePath = join(workDir, "updates.json");
  writeFileSync(
    filePath,
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
  return filePath;
}

describe("parseUpdateArgs", () => {
  it("defaults to dry-run with a positional JSON file", () => {
    expect(parseUpdateArgs(["updates.json"])).toEqual({
      file: "updates.json",
      apply: false,
    });
  });

  it("parses --apply and an explicit --dry-run", () => {
    expect(parseUpdateArgs(["updates.json", "--apply"])).toEqual({
      file: "updates.json",
      apply: true,
    });
    expect(parseUpdateArgs(["updates.json", "--dry-run"])).toEqual({
      file: "updates.json",
      apply: false,
    });
  });

  it("rejects missing file, conflicting modes, and unknown flags", () => {
    expect(() => parseUpdateArgs([])).toThrow(/json/i);
    expect(() => parseUpdateArgs(["--apply"])).toThrow(/json/i);
    expect(() =>
      parseUpdateArgs(["updates.json", "--apply", "--dry-run"]),
    ).toThrow(/exactly one/i);
    expect(() => parseUpdateArgs(["updates.json", "--force"])).toThrow(
      /--force/,
    );
    expect(() => parseUpdateArgs(["a.json", "b.json"])).toThrow(
      /exactly one/i,
    );
  });
});

describe("readDescriptionUpdates", () => {
  it("reads a slug-to-description map sorted by slug", () => {
    const filePath = writeUpdates({
      "wild-boar": "A boar pet.",
      kesha: "A green parrot pet.",
    });

    expect(readDescriptionUpdates(filePath)).toEqual([
      { slug: "kesha", description: "A green parrot pet." },
      { slug: "wild-boar", description: "A boar pet." },
    ]);
  });

  it("accepts a description of exactly the hard limit", () => {
    const filePath = writeUpdates({
      kesha: "x".repeat(MAX_DESCRIPTION_LENGTH),
    });

    expect(readDescriptionUpdates(filePath)).toEqual([
      { slug: "kesha", description: "x".repeat(MAX_DESCRIPTION_LENGTH) },
    ]);
    expect(MAX_DESCRIPTION_LENGTH).toBe(320);
  });

  it("refuses a missing file", () => {
    expect(() => readDescriptionUpdates(join(workDir, "nope.json"))).toThrow(
      /read/i,
    );
  });

  it("refuses invalid JSON", () => {
    const filePath = writeUpdates("{ not json");

    expect(() => readDescriptionUpdates(filePath)).toThrow(/json/i);
  });

  it.each([[["kesha"]], ['"kesha"'], [null], [42]])(
    "refuses non-object payloads like %j",
    (payload) => {
      const filePath = writeUpdates(payload);

      expect(() => readDescriptionUpdates(filePath)).toThrow(/slug/i);
    },
  );

  it("refuses empty and whitespace-only descriptions", () => {
    for (const description of ["", "   ", "\n\t"]) {
      const filePath = writeUpdates({ kesha: description });

      expect(() => readDescriptionUpdates(filePath)).toThrow(/kesha/);
    }
  });

  it("refuses non-string descriptions", () => {
    const filePath = writeUpdates({ kesha: { text: "nested" } });

    expect(() => readDescriptionUpdates(filePath)).toThrow(/kesha/);
  });

  it("refuses descriptions beyond the hard limit and reports it", () => {
    const filePath = writeUpdates({
      kesha: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
    });

    expect(() => readDescriptionUpdates(filePath)).toThrow(/320/);
  });

  it("aggregates every invalid entry into one refusal", () => {
    const filePath = writeUpdates({
      kesha: "",
      "wild-boar": "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
      polin: "fine description",
    });

    let error: unknown;
    try {
      readDescriptionUpdates(filePath);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("kesha");
    expect(String(error)).toContain("wild-boar");
    expect(String(error)).not.toContain("polin");
  });
});

describe("assertAllSlugsFound", () => {
  it("passes when every slug exists in the current map and is approved", () => {
    expect(() =>
      assertAllSlugsFound(
        [{ slug: "kesha", description: "next" }],
        new Map([["kesha", { description: "current", status: "approved" }]]),
      ),
    ).not.toThrow();
  });

  it("refuses the whole batch when any slug is unknown", () => {
    expect(() =>
      assertAllSlugsFound(
        [
          { slug: "kesha", description: "next" },
          { slug: "ghost", description: "next" },
        ],
        new Map([["kesha", { description: "current", status: "approved" }]]),
      ),
    ).toThrow(/ghost/);
  });

  it("refuses the whole batch when any slug is not approved", () => {
    expect(() =>
      assertAllSlugsFound(
        [
          { slug: "kesha", description: "next" },
          { slug: "wild-boar", description: "next" },
        ],
        new Map([
          ["kesha", { description: "current", status: "approved" }],
          ["wild-boar", { description: "current", status: "deleted" }],
        ]),
      ),
    ).toThrow(/wild-boar \(status: deleted\)/);
  });
});

describe("assertAllDescriptionsChanged", () => {
  it("passes when every update differs from the stored description", () => {
    expect(() =>
      assertAllDescriptionsChanged(
        [{ slug: "kesha", description: "next" }],
        new Map([["kesha", { description: "current", status: "approved" }]]),
      ),
    ).not.toThrow();
  });

  it("refuses the whole batch when any description is identical to the stored one", () => {
    expect(() =>
      assertAllDescriptionsChanged(
        [
          { slug: "kesha", description: "next" },
          { slug: "wild-boar", description: "current boar" },
        ],
        new Map([
          ["kesha", { description: "current", status: "approved" }],
          ["wild-boar", { description: "current boar", status: "approved" }],
        ]),
      ),
    ).toThrow(/wild-boar/);
  });
});

describe("buildEmbeddingBackfillCommands", () => {
  it("describes all V24 related-pet derived inputs to operators", () => {
    const source = readFileSync(
      new URL("./update-pet-descriptions.mjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain("V24 related-pet derived inputs");
    expect(source).not.toContain("related-query embeddings");
    expect(source).not.toContain("document and related-query backfills");
  });

  it("prints one apply command per updated slug", () => {
    expect(buildEmbeddingBackfillCommands(["kesha", "wild-boar"])).toEqual([
      "node scripts/backfill-pet-search-embeddings.mjs --apply --slug kesha",
      "node scripts/backfill-pet-search-embeddings.mjs --apply --slug wild-boar",
    ]);
  });

  it("refreshes every V24 text input before rebuilding snapshots", () => {
    const commands = [
      ...buildRelatedPetsDerivedBackfillCommands(["kesha", "wild-boar"]),
      ...RELATED_PETS_REBUILD_COMMANDS,
    ];

    expect(commands).toEqual([
      "npm run related:backfill-description-query -- --apply --slug kesha",
      "npm run related:backfill-description-document -- --apply --slug kesha",
      "npm run related:backfill-annotations -- --apply --slug kesha",
      "npm run related:backfill-annotation-query -- --apply --slug kesha",
      "npm run related:backfill-annotation-document -- --apply --slug kesha",
      "npm run related:backfill-description-query -- --apply --slug wild-boar",
      "npm run related:backfill-description-document -- --apply --slug wild-boar",
      "npm run related:backfill-annotations -- --apply --slug wild-boar",
      "npm run related:backfill-annotation-query -- --apply --slug wild-boar",
      "npm run related:backfill-annotation-document -- --apply --slug wild-boar",
      "npm run related:rebuild -- --dry-run",
      "npm run related:rebuild -- --apply",
    ]);
  });
});
