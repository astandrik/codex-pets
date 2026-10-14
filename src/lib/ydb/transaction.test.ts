import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusCode, YdbError } from "@/lib/ydb/client";
import { withSdkManagedTransaction } from "./transaction";

const session = vi.hoisted(() => ({ beginTransaction: vi.fn(), executeQuery: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn() }));
const access = vi.hoisted(() => ({ withSession: vi.fn(), withSessionOnce: vi.fn() }));
vi.mock("@/lib/ydb/client", async (original) => ({ ...await original<typeof import("@/lib/ydb/client")>(), ...access }));
class Aborted extends YdbError { static status = StatusCode.ABORTED; }

beforeEach(() => {
  vi.resetAllMocks();
  access.withSession.mockImplementation((operation) => operation(session));
  session.beginTransaction.mockResolvedValue({ id: "legacy-tx" });
  session.executeQuery.mockResolvedValue({ resultSets: [] });
  session.commitTransaction.mockResolvedValue(undefined);
  session.rollbackTransaction.mockResolvedValue(undefined);
});

describe("SDK-managed transaction compatibility", () => {
  it("uses the retrying session boundary and commits through the SDK with the same transaction identity", async () => {
    const result = { accepted: true };
    const operation = vi.fn(async (current, control) => {
      expect(current).toBe(session);
      await current.executeQuery("synthetic statement", {}, control);
      return result;
    });
    await expect(withSdkManagedTransaction(operation, "start failed")).resolves.toBe(result);
    expect(access.withSession).toHaveBeenCalledTimes(1);
    expect(access.withSessionOnce).not.toHaveBeenCalled();
    expect(session.executeQuery).toHaveBeenCalledExactlyOnceWith("synthetic statement", {}, { txId: "legacy-tx" });
    expect(session.commitTransaction).toHaveBeenCalledExactlyOnceWith({ txId: "legacy-tx" });
    expect(session.rollbackTransaction).not.toHaveBeenCalled();
  });

  it.each(["Unable to start YDB transaction.", "Unable to start approval transaction.", "Unable to start related pets transaction."])("preserves the caller's start failure: %s", async (message) => {
    session.beginTransaction.mockResolvedValue({});
    const operation = vi.fn();
    await expect(withSdkManagedTransaction(operation, message)).rejects.toThrow(message);
    expect(operation).not.toHaveBeenCalled();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).not.toHaveBeenCalled();
  });

  it("propagates begin failure without rollback or callback", async () => {
    const error = new Error("synthetic begin failure");
    session.beginTransaction.mockRejectedValue(error);
    const operation = vi.fn();
    await expect(withSdkManagedTransaction(operation, "start failed")).rejects.toBe(error);
    expect(operation).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves a callback conflict without adding ABORTED replay (rollback failure: %s)", async (rollbackFails) => {
    const error = new Aborted("synthetic conflict");
    const operation = vi.fn().mockRejectedValue(error);
    if (rollbackFails) session.rollbackTransaction.mockRejectedValue(new Error("synthetic rollback failure"));
    await expect(withSdkManagedTransaction(operation, "start failed")).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(session.beginTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).toHaveBeenCalledExactlyOnceWith({ txId: "legacy-tx" });
  });

  it("preserves a failed SDK commit and rolls back without replaying the callback", async () => {
    const error = new Aborted("synthetic commit conflict");
    session.commitTransaction.mockRejectedValue(error);
    const operation = vi.fn().mockResolvedValue("not committed");
    await expect(withSdkManagedTransaction(operation, "start failed")).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.rollbackTransaction).toHaveBeenCalledExactlyOnceWith({ txId: "legacy-tx" });
    expect(session.executeQuery).not.toHaveBeenCalled();
  });
});
