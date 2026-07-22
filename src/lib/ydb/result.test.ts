import { describe, expect, it } from "vitest";

import { floatAt } from "@/lib/ydb/result";

describe("YDB result helpers", () => {
  it("reads float and double result cells", () => {
    expect(floatAt({ items: [{ floatValue: 0.75 }] }, 0)).toBe(0.75);
    expect(floatAt({ items: [{ doubleValue: 0.625 }] }, 0)).toBe(0.625);
    expect(floatAt({ items: [] }, 0)).toBe(0);
  });
});
