import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
} from "../src/lib/pets/related-pets-annotation-contract.mjs";

describe("runner image maintenance contract", () => {
  it("validates one required public origin before building and starting", () => {
    const dockerfile = readFileSync(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const runnerStage = dockerfile.slice(
      dockerfile.indexOf("FROM node:22-bookworm-slim AS runner"),
    );

    expect(dockerfile).not.toMatch(/^ARG NEXT_PUBLIC_APP_URL=/m);
    expect(dockerfile.indexOf("npm run validate:public-build")).toBeLessThan(
      dockerfile.indexOf("npm run build"),
    );
    expect(runnerStage).toContain("ARG NEXT_PUBLIC_APP_URL");
    expect(runnerStage).toContain("ARG NEXT_PUBLIC_BASE_PATH");
    expect(runnerStage).toContain(
      "ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL",
    );
    expect(runnerStage).toContain(
      "ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH",
    );
    expect(runnerStage).toContain(
      "ENV CODEX_PETS_BUILT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL",
    );
    expect(runnerStage).toContain(
      "ENV CODEX_PETS_BUILT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH",
    );
    expect(runnerStage).toContain('CMD ["npm", "run", "start:docker"]');
    expect(packageJson.scripts["start:docker"]).toBe(
      "npm run validate:public-build && next start",
    );
    expect(packageJson.scripts["test:production-origin"]).toBe(
      "node scripts/public-origin-image-smoke.mjs",
    );
    expect(packageJson.scripts).toMatchObject({
      dev: "next dev",
      build: "next build",
      start: "next start",
    });
  });

  it("bounds the runtime-mismatch negative control", () => {
    const smokeScript = readFileSync(
      new URL("./public-origin-image-smoke.mjs", import.meta.url),
      "utf8",
    );
    const mismatchEnvironment = smokeScript.indexOf(
      "NEXT_PUBLIC_APP_URL=https://runtime.example",
    );
    const negativeControlStart = smokeScript.lastIndexOf(
      'await run("docker"',
      mismatchEnvironment,
    );
    const negativeControlEnd = smokeScript.indexOf(
      "Verified ${endpoints.length}",
      negativeControlStart,
    );

    expect(negativeControlStart).toBeGreaterThan(0);
    expect(negativeControlEnd).toBeGreaterThan(negativeControlStart);

    const negativeControl = smokeScript.slice(
      negativeControlStart,
      negativeControlEnd,
    );
    expect(negativeControl).toContain('"--detach"');
    expect(negativeControl).not.toContain('"--rm"');
    expect(negativeControl).toContain('["wait", container]');
    expect(negativeControl).toContain("timeoutMs: 15_000");
    expect(negativeControl).toContain('["logs", "--tail", "40", container]');
  });

  it("packages the annotation requester and uses current vector revisions", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const [role, revision] of [
      ["query", RELATED_PETS_ANNOTATION_QUERY_REVISION],
      ["document", RELATED_PETS_ANNOTATION_DOCUMENT_REVISION],
    ]) {
      expect(packageJson.scripts[`related:backfill-annotation-${role}`]).toBe(
        `PET_SEARCH_MODEL_REVISION=${revision} node scripts/backfill-related-pet-annotation-embeddings.mjs`,
      );
    }
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY --from=builder /app/src ./src");
    expect(readFileSync(
      new URL("../src/lib/pets/related-pets-annotation-client.mjs", import.meta.url),
      "utf8",
    )).toContain('./related-pets-annotation-requester.mjs');
  });

  it("uses the packaged TypeScript loader for the approval worker", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["related:approval-worker"]).toBe(
      "node ./scripts/related-pet-approval-worker.mjs",
    );
    expect(readFileSync(
      new URL("./related-pet-approval-worker.mjs", import.meta.url),
      "utf8",
    )).toContain(
      'register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url)',
    );
  });

  it("copies YDB migrations required by the packaged db:migrate script", () => {
    const dockerfile = readFileSync(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("COPY --from=builder /app/ydb ./ydb");
  });

  it("copies the Vitest config required by packaged eval scripts", () => {
    const dockerfile = readFileSync(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(
      "COPY --from=builder /app/vitest.config.ts ./vitest.config.ts",
    );
  });

  it("packages only the current related verification entrypoint", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const dockerignore = readFileSync(
      new URL("../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(packageJson.scripts["related:verify:v24"]).toBe(
      "node --disable-warning=ExperimentalWarning scripts/verify-related-pets-v24.mjs",
    );
    expect(dockerignore).not.toContain("related-pets-live-eval.test.ts");
    expect(dockerignore).toContain("!src/lib/pets/search-live-eval.test.ts");
  });

  it("keeps local worktrees and scratch evidence out of Docker builds", () => {
    const dockerignore = readFileSync(
      new URL("../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(dockerignore).toMatch(/^\.scratch$/m);
    expect(dockerignore).toMatch(/^\.worktrees$/m);
  });

  it("documents the fail-closed preparation default in runtime examples", () => {
    for (const path of [
      "../.env.example",
      "../deploy/app-session.env.runtime.example",
      "../DEPLOYMENT.md",
    ]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8")).toContain(
        "PET_RELATED_PREAPPROVAL_ENABLED=false",
      );
    }
  });

  it("describes the full V24 maintenance sequence", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const section = readme.slice(
      readme.indexOf("An applied text or visual backfill"),
      readme.indexOf("Related-pets description similarity"),
    );

    expect(section).toContain("Run the full V24 derived-data sequence");
    expect(section).not.toContain("Run both commands");
  });
});
