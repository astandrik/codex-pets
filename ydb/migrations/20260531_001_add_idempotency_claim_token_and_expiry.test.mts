import { describe, expect, it, vi } from "vitest";

type MigrationModule = {
  up(input: {
    sdk: {
      AlterTableDescription: new () => unknown;
      Column: new (...args: unknown[]) => unknown;
      Types: { optional: (type: unknown) => unknown; UTF8: string };
      TypedValues: { utf8: (value: string) => string };
    };
    execute: (statement: string, params: Record<string, unknown>) => Promise<void>;
    withSession: (callback: (session: unknown) => unknown) => Promise<unknown>;
  }): Promise<void>;
};

describe("20260531 idempotency claim token migration", () => {
  it("backfills missing claim_token with an empty token instead of updated_at", async () => {
    const { up } = await import(
      new URL(
        "./20260531_001_add_idempotency_claim_token_and_expiry.mjs",
        import.meta.url,
      ).href
    ) as MigrationModule;
    const execute = vi.fn();
    const withSession = vi.fn(async (callback) =>
      callback({
        describeTable: vi.fn(async () => ({
          columns: [
            { name: "claim_token" },
            { name: "expires_at" },
          ],
        })),
      }),
    );

    await up({
      sdk: {
        AlterTableDescription: class {},
        Column: class {},
        Types: { optional: (type: unknown) => type, UTF8: "utf8" },
        TypedValues: { utf8: (value: string) => value },
      },
      execute,
      withSession,
    });

    const [statement, params] = execute.mock.calls[0] ?? [];
    expect(statement).toContain("DECLARE $empty_claim_token AS Utf8;");
    expect(statement).toContain("WHEN claim_token IS NULL THEN $empty_claim_token");
    expect(statement).not.toContain("WHEN claim_token IS NULL THEN updated_at");
    expect(params).toMatchObject({
      $empty_claim_token: "",
    });
  });
});
