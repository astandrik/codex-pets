import { describe, expect, it, vi } from "vitest";

const {
  RELATED_PETS_REBUILD_HELP,
  parseRelatedPetsRebuildArgs,
  runRelatedPetsRebuildCli,
} = await import("./rebuild-related-pets.mjs");

describe("related pets rebuild CLI", () => {
  it("parses each discoverable mode and rejects ambiguous mutation modes", () => {
    expect(parseRelatedPetsRebuildArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
    });
    expect(parseRelatedPetsRebuildArgs(["--apply"])).toEqual({
      mode: "apply",
    });
    expect(parseRelatedPetsRebuildArgs(["--recover-previous"])).toEqual({
      mode: "recover-previous",
    });
    expect(parseRelatedPetsRebuildArgs(["--help"])).toEqual({ mode: "help" });
    expect(() => parseRelatedPetsRebuildArgs([])).toThrow(
      /--dry-run.*--apply.*--recover-previous/,
    );
    expect(() =>
      parseRelatedPetsRebuildArgs(["--apply", "--recover-previous"]),
    ).toThrow(/exactly one/i);
    expect(() =>
      parseRelatedPetsRebuildArgs(["--dry-run", "--unknown"]),
    ).toThrow(/unknown argument/i);
  });

  it("documents exact npm invocations and exits help without loading runtime", async () => {
    const loadService = vi.fn();
    const output: string[] = [];

    await expect(
      runRelatedPetsRebuildCli({
        argv: ["--help"],
        loadService,
        write: (line: string) => output.push(line),
      }),
    ).resolves.toBe(0);

    expect(output).toEqual([RELATED_PETS_REBUILD_HELP]);
    expect(output[0]).toContain("npm run related:rebuild -- --dry-run");
    expect(output[0]).toContain("npm run related:rebuild -- --apply");
    expect(output[0]).toContain(
      "npm run related:rebuild -- --recover-previous",
    );
    expect(loadService).not.toHaveBeenCalled();
  });

  it("orchestrates rebuild and recovery through the injected service", async () => {
    const rebuild = vi.fn(async () => ({
      operation: "apply" as const,
      status: "ready" as const,
      generationId: "generation-new",
      rankingRevision: "ranking-v1",
      coverage: {
        approvedPetCount: 3,
        snapshotCount: 3,
        textVectorCount: 3,
        visualVectorCount: 2,
      },
      rankings: [{ sourceSlug: "source", relatedSlugs: ["peer"] }],
      durationMs: 10,
    }));
    const recoverPrevious = vi.fn(async () => ({
      status: "recovered" as const,
      generationId: "generation-old",
      rankingRevision: "ranking-v1",
      durationMs: 5,
    }));
    const output: string[] = [];
    const loadService = async () => ({ rebuild, recoverPrevious });

    await runRelatedPetsRebuildCli({
      argv: ["--apply"],
      loadService,
      write: (line: string) => output.push(line),
    });
    await runRelatedPetsRebuildCli({
      argv: ["--recover-previous"],
      loadService,
      write: (line: string) => output.push(line),
    });

    expect(rebuild).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
    expect(recoverPrevious).toHaveBeenCalledOnce();
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        operation: "apply",
        status: "ready",
        generationId: "generation-new",
        rankingRevision: "ranking-v1",
        coverage: {
          approvedPetCount: 3,
          snapshotCount: 3,
          textVectorCount: 3,
          visualVectorCount: 2,
        },
        durationMs: 10,
      },
      {
        operation: "recover-previous",
        status: "recovered",
        generationId: "generation-old",
        rankingRevision: "ranking-v1",
        durationMs: 5,
      },
    ]);
  });

  it("passes dry-run through without exposing ranking rows in CLI logs", async () => {
    const write = vi.fn();
    const rebuild = vi.fn(async () => ({
      operation: "dry-run" as const,
      status: "dry-run" as const,
      generationId: null,
      rankingRevision: "ranking-v1",
      coverage: {
        approvedPetCount: 1,
        snapshotCount: 1,
        textVectorCount: 1,
        visualVectorCount: 0,
      },
      rankings: [{ sourceSlug: "private-slug", relatedSlugs: [] }],
      durationMs: 2,
    }));

    await runRelatedPetsRebuildCli({
      argv: ["--dry-run"],
      loadService: async () => ({
        rebuild,
        recoverPrevious: vi.fn(),
      }),
      write,
    });

    expect(rebuild).toHaveBeenCalledWith({
      mode: "dry-run",
      includeVisual: true,
    });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).not.toContain("private-slug");
  });
});
