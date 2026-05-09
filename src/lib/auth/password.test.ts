import { describe, expect, it, vi } from "vitest";

import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";

describe("password helpers", () => {
  it("validates password length", () => {
    expect(validatePasswordStrength("short")).toContain("at least");
    expect(validatePasswordStrength("long-enough")).toBeNull();
  });

  it("hashes and verifies passwords", async () => {
    vi.stubEnv("PASSWORD_PEPPER", "pepper-value");

    const hashed = await hashPassword("secret-password");
    expect(await verifyPassword("secret-password", hashed)).toBe(true);
    expect(await verifyPassword("wrong-password", hashed)).toBe(false);

    vi.unstubAllEnvs();
  });
});
