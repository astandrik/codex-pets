import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "@/lib/json-ld";

describe("serializeJsonLd", () => {
  it("escapes characters that can break out of a script tag", () => {
    const value = serializeJsonLd({
      name: '</script><script>alert("xss")</script>',
      bio: "A & B > C",
    });

    expect(value).toContain("\\u003c/script\\u003e");
    expect(value).toContain("\\u0026");
    expect(value).toContain("\\u003e");
    expect(value).not.toContain("</script>");
  });
});
