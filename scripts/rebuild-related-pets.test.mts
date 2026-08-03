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
  it("loads the production TypeScript service in a real CLI subprocess", () => {
    const result = spawnSync(cliNodeBinary, [cliPath, "--dry-run"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: unconfiguredCliEnvironment(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(lastJsonLine(result.stdout)).toMatchObject({
      operation: "dry-run",
      status: "dry-run",
      generationId: null,
      coverage: {
        approvedPetCount: 0,
        snapshotCount: 0,
        textVectorCount: 0,
        visualVectorCount: 0,
      },
    });
  });

  it("fails unconfigured apply distinctly from supersession", () => {
    const result = spawnSync(cliNodeBinary, [cliPath, "--apply"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: unconfiguredCliEnvironment(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(lastJsonLine(result.stderr)).toEqual({
      operation: "related-pets-rebuild",
      status: "failed",
      failureReason: "storage_unavailable",
    });
  });

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
    const dispose = vi.fn(async () => undefined);
    const loadService = async () => ({ rebuild, recoverPrevious, dispose });

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
