import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

  it("keeps the packaged live eval suites in the Docker build context", () => {
    const dockerignore = readFileSync(
      new URL("../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-live-eval.test.ts",
    );
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
});
