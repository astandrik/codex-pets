import { describe, expect, it } from "vitest";

import { statusAfterModeration } from "@/lib/pets/moderation";

describe("moderation status transitions", () => {
  it("publishes pending pets on approval", () => {
    expect(statusAfterModeration("pending", "approved")).toBe("approved");
  });

  it("rejects pending pets with a review decision", () => {
    expect(statusAfterModeration("pending", "rejected")).toBe("rejected");
  });
});
