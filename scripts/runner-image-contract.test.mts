import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("runner image maintenance contract", () => {
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
