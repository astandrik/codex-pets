import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const {
  RELATED_PETS_REBUILD_HELP,
  parseRelatedPetsRebuildArgs,
  runRelatedPetsRebuildCli,
} = await import("./rebuild-related-pets.mjs");

const cliPath = fileURLToPath(
  new URL("./rebuild-related-pets.mjs", import.meta.url),
);
const cliNodeBinary =
  process.env.RELATED_PETS_CLI_NODE_BINARY ?? process.execPath;

function unconfiguredCliEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.YDB_PETS_ENDPOINT;
  delete environment.YDB_PETS_DATABASE;
  delete environment.USE_MOCK_PETS;
  return environment;
}

function lastJsonLine(output: string): Record<string, unknown> {
  const line = output
    .trim()
    .split("\n")
    .toReversed()
    .find((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error("CLI did not emit a JSON summary.");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("related pets rebuild CLI", () => {
  it.each([
    { label: "--dry-run", args: ["--dry-run"] },
    { label: "--apply", args: ["--apply"] },
    {
      label: "--recover-previous",
      args: [
        "--recover-previous",
        "11111111-1111-4111-8111-111111111111",
      ],
    },
  ])(
    "loads the production TypeScript service and fails unconfigured $label safely",
    ({ args }) => {
      const result = spawnSync(cliNodeBinary, [cliPath, ...args], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: unconfiguredCliEnvironment(),
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(1);
      expect(lastJsonLine(result.stderr)).toEqual({
        operation: "related-pets-rebuild",
        status: "failed",
        failureReason: "storage_unavailable",
      });
    },
  );

  it("disposes the production service when a rebuild fails", async () => {
    const dispose = vi.fn(async () => undefined);

    await expect(
      runRelatedPetsRebuildCli({
        argv: ["--dry-run"],
        loadService: async () => ({
          rebuild: async () => {
            throw new Error("storage_unavailable");
          },
          recoverPrevious: vi.fn(),
          dispose,
        }),
      }),
    ).rejects.toThrow("storage_unavailable");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("parses each discoverable mode and rejects ambiguous mutation modes", () => {
    expect(parseRelatedPetsRebuildArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
    });
    expect(parseRelatedPetsRebuildArgs(["--apply"])).toEqual({
      mode: "apply",
    });
    expect(
      parseRelatedPetsRebuildArgs([
        "--recover-previous",
        "11111111-1111-4111-8111-111111111111",
      ]),
    ).toEqual({
      mode: "recover-previous",
      targetGenerationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseRelatedPetsRebuildArgs(["--help"])).toEqual({ mode: "help" });
    expect(() => parseRelatedPetsRebuildArgs([])).toThrow(
      /--dry-run.*--apply.*--recover-previous/,
    );
    expect(() =>
      parseRelatedPetsRebuildArgs(["--apply", "--recover-previous"]),
    ).toThrow(/exactly one/i);
    expect(() =>
      parseRelatedPetsRebuildArgs(["--recover-previous"]),
    ).toThrow(/generation id/i);
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
      "npm run related:rebuild -- --recover-previous GENERATION_ID",
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
    const dispose = vi.fn(async () => undefined);
    const loadService = async () => ({ rebuild, recoverPrevious, dispose });

    await runRelatedPetsRebuildCli({
      argv: ["--apply"],
      loadService,
      write: (line: string) => output.push(line),
    });
    await runRelatedPetsRebuildCli({
      argv: [
        "--recover-previous",
        "11111111-1111-4111-8111-111111111111",
      ],
      loadService,
      write: (line: string) => output.push(line),
    });

    expect(rebuild).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
    expect(recoverPrevious).toHaveBeenCalledWith({
      targetGenerationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(dispose).toHaveBeenCalledTimes(2);
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

  it("returns failure when no previous generation is available to recover", async () => {
    const dispose = vi.fn(async () => undefined);
    const output: string[] = [];

    await expect(
      runRelatedPetsRebuildCli({
        argv: [
          "--recover-previous",
          "11111111-1111-4111-8111-111111111111",
        ],
        loadService: async () => ({
          rebuild: vi.fn(),
          recoverPrevious: async () => ({
            status: "unavailable" as const,
            generationId: null,
            rankingRevision: "ranking-v1",
            durationMs: 5,
          }),
          dispose,
        }),
        write: (line: string) => output.push(line),
      }),
    ).resolves.toBe(1);

    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        operation: "recover-previous",
        status: "unavailable",
        generationId: null,
        rankingRevision: "ranking-v1",
        durationMs: 5,
      },
    ]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("returns failure when an apply is superseded before activation", async () => {
    const dispose = vi.fn(async () => undefined);
    const output: string[] = [];

    await expect(
      runRelatedPetsRebuildCli({
        argv: ["--apply"],
        loadService: async () => ({
          rebuild: async () => ({
            operation: "apply" as const,
            status: "superseded" as const,
            generationId: "generation-superseded",
            rankingRevision: "ranking-v1",
            coverage: {
              approvedPetCount: 3,
              snapshotCount: 3,
              textVectorCount: 3,
              visualVectorCount: 2,
            },
            rankings: [{ sourceSlug: "source", relatedSlugs: ["peer"] }],
            durationMs: 10,
          }),
          recoverPrevious: vi.fn(),
          dispose,
        }),
        write: (line: string) => output.push(line),
      }),
    ).resolves.toBe(1);

    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        operation: "apply",
        status: "superseded",
        generationId: "generation-superseded",
        rankingRevision: "ranking-v1",
        coverage: {
          approvedPetCount: 3,
          snapshotCount: 3,
          textVectorCount: 3,
          visualVectorCount: 2,
        },
        durationMs: 10,
      },
    ]);
    expect(dispose).toHaveBeenCalledOnce();
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
