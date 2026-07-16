import { describe, expect, it } from "vitest";

import { buildIndexMarkdown } from "@/lib/agent-markdown";

describe("agent markdown sprite guidance", () => {
  it("documents both supported atlas versions in the index fallback", () => {
    const markdown = buildIndexMarkdown();

    expect(markdown).toContain(
      "Version 1 may omit spriteVersionNumber and uses a 1536 by 1872 pixel atlas arranged as eight columns and nine rows.",
    );
    expect(markdown).toContain(
      "Version 2 sets spriteVersionNumber to 2 and uses a 1536 by 2288 pixel atlas arranged as eight columns and eleven rows.",
    );
  });
});
