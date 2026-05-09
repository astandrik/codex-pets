import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/uploads/presign/route";

describe("POST /api/uploads/presign", () => {
  it("returns 410 because presigned uploads are deprecated", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
  });
});
