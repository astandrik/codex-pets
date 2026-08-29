import { describe, expect, it } from "vitest";

import { boolAt, floatAt } from "@/lib/ydb/result";

describe("YDB result helpers", () => {
  it("reads float and double result cells", () => {
    expect(floatAt({ items: [{ floatValue: 0.75 }] }, 0)).toBe(0.75);
    expect(floatAt({ items: [{ doubleValue: 0.625 }] }, 0)).toBe(0.625);
    expect(floatAt({ items: [] }, 0)).toBe(0);
  });

  it("reads bool result cells and defaults missing optional values", () => {
    expect(boolAt({ items: [{ boolValue: true }] }, 0)).toBe(true);
    expect(boolAt({ items: [{ boolValue: false }] }, 0)).toBe(false);
    expect(boolAt({ items: [] }, 0)).toBe(false);
  });
});
