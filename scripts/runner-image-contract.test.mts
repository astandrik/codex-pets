import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("runner image maintenance contract", () => {
  it("uses the packaged TypeScript loader for the approval worker", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const workerCommand = packageJson.scripts["related:approval-worker"];

    expect(workerCommand).toBe(
      "node ./scripts/related-pet-approval-worker.mjs",
    );
    expect(
      readFileSync(
        new URL("./related-pet-approval-worker.mjs", import.meta.url),
        "utf8",
      ),
    ).toContain(
      'register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url)',
    );
    expect(
      readFileSync(
        new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url),
        "utf8",
      ),
    ).toContain("export function initialize");
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
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const dockerignore = readFileSync(
      new URL("../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-acceptance-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v10-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v11-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v23-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v24-live-eval.test.ts",
    );
    expect(packageJson.scripts["related:eval:v24:acceptance"]).toContain(
      "related-pets-v24-live-eval.test.ts",
    );
    expect(dockerignore).toContain("!src/lib/pets/search-live-eval.test.ts");
  });
});
