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
});
