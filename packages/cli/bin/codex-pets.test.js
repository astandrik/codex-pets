import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));

describe("codex-pets bin launcher", () => {
  it("prints a clear error on unsupported Node versions", () => {
    const code = fs.readFileSync(path.join(currentDir, "codex-pets.cjs"), "utf8");
    const errors = [];
    const context = {
      require,
      __dirname: currentDir,
      console: {
        error(...args) {
          errors.push(args.join(" "));
        },
      },
      process: {
        versions: {
          node: "16.20.0",
        },
        exitCode: 0,
      },
    };

    vm.runInNewContext(code, context);

    expect(errors[0]).toContain("codex-pets requires Node.js 18 or newer");
    expect(errors[0]).toContain("Current Node.js is 16.20.0");
    expect(context.process.exitCode).toBe(1);
  });
});
