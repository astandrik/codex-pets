import type { Session } from "ydb-sdk";

import { StatusCode, YdbError, withSession, withSessionOnce, type YdbQueryExecutor } from "@/lib/ydb/client";

// Callbacks may contain only replay-safe database work, never provider calls.
export async function withSerializableTransaction<T>(operation: (execute: YdbQueryExecutor) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withSessionOnce(async session => {
        const begun = await session.beginTransaction({ serializableReadWrite: {} });
        if (!begun.id) throw new Error("Serializable transaction unavailable");
        const control = { txId: begun.id };
        try {
          const result = await operation((sql, params) => session.executeQuery(sql, params, control));
          // Avoid SDK commitTransaction's in-place retry after ABORTED: replay
          // the whole transaction instead, preserving its conflict status.
          await session.executeQuery("SELECT 1;", {}, { ...control, commitTx: true });
          return result;
        } catch (error) {
          await session.rollbackTransaction(control).catch(() => undefined);
          throw error;
        }
      });
    } catch (error) {
      if (!(error instanceof YdbError) || Reflect.get(error.constructor, "status") !== StatusCode.ABORTED || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

// Preserve the older SDK-managed session/commit retry contract for existing
// repositories. Do not replace this with ABORTED replay without a caller audit.
export async function withSdkManagedTransaction<T>(
  operation: (session: Session, control: { txId: string }) => Promise<T>,
  startError: string,
): Promise<T> {
  return withSession(async (session) => {
    const transaction = await session.beginTransaction({ serializableReadWrite: {} });
    if (!transaction.id) throw new Error(startError);
    const control = { txId: transaction.id };
    try {
      const result = await operation(session, control);
      await session.commitTransaction(control);
      return result;
    } catch (error) {
      try {
        await session.rollbackTransaction(control);
      } catch {
        // YDB may already have aborted or committed this transaction.
      }
      throw error;
    }
  });
}
