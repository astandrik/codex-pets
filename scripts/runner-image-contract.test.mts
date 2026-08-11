import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("runner image maintenance contract", () => {
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
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-acceptance-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v10-live-eval.test.ts",
    );
    expect(dockerignore).toContain(
      "!src/lib/pets/related-pets-v11-live-eval.test.ts",
    );
    expect(dockerignore).toContain("!src/lib/pets/search-live-eval.test.ts");
  });
});
