import { isIP } from "node:net";
import { z } from "zod";
import { DAY, GenerationError, generationDigest, moscowDay, nextMoscowDay } from "@/lib/pets/generation/model";
import type { GenerationStore, GenerationTransaction } from "@/lib/pets/generation/store";
import { IP_DAILY_LIMIT, GLOBAL_DAILY_LIMIT, MAX_EXTRA_ATTEMPTS } from "@/lib/pets/generation/quota-limits";

export { IP_DAILY_LIMIT, GLOBAL_DAILY_LIMIT } from "@/lib/pets/generation/quota-limits";
const AUDIT_RETENTION = 30 * DAY;
export const quotaGrantSchema = z.object({ ip: z.string().max(64), amount: z.number().int().min(1).max(MAX_EXTRA_ATTEMPTS),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requestId: z.uuid() }).strict();
export type QuotaGrantInput = z.infer<typeof quotaGrantSchema>;
const receiptSchema = z.object({ requestId: z.uuid(), day: z.string(), amount: z.number().int().min(1).max(MAX_EXTRA_ATTEMPTS),
  totalExtra: z.number().int().min(1).max(MAX_EXTRA_ATTEMPTS), grantedAt: z.string(), expiresAt: z.string() }).strict();
export type QuotaGrantReceipt = z.infer<typeof receiptSchema>;
const grantEventSchema = z.object({ actorId: z.string().min(1).max(128), receipt: receiptSchema }).strict();
const bonusSchema = z.object({ extra: z.number().int().min(0).max(MAX_EXTRA_ATTEMPTS), events: z.array(grantEventSchema) }).strict();
const requestSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), event: grantEventSchema }).strict();

export function normalizeQuotaIp(input: string): string {
  const ip = input.trim();
  if (!/^[a-fA-F0-9:.]+$/.test(ip) || !isIP(ip)) throw new GenerationError("invalid_argument");
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1,-1) : ip;
}
function keys(secret: string, input: string, now: number) {
  const raw = input.trim(); const ip = normalizeQuotaIp(input); const day = moscowDay(now);
  const digest = generationDigest(secret, "ip", `${day}:${ip}`);
  return { ip, day, global: `day:${day}`, counter: `ip:${day}:${digest}`, bonus: `quota-grant:ip:${day}:${digest}`,
    legacy: `ip:${day}:${generationDigest(secret, "ip", `${day}:${raw}`)}` };
}
const count = (value: string | null) => z.coerce.number().int().nonnegative().safe().parse(value ?? "0");
async function readBonus(tx: GenerationTransaction, key: string, now: number) {
  const value = await tx.getLedger(key, now);
  return value ? bonusSchema.parse(JSON.parse(value)) : { extra: 0, events: [] };
}
export async function readDailyQuota(tx: GenerationTransaction, secret: string, ip: string, now: number) {
  const key = keys(secret, ip, now);
  const used = count(await tx.getLedger(key.counter, now));
  // Preserve already-consumed pre-normalization counters when a trusted origin supplied a
  // different IPv6 spelling. Admission synchronizes both without decreasing either value.
  const legacy = key.legacy === key.counter ? used : count(await tx.getLedger(key.legacy, now));
  const ipUsed = Math.max(used, legacy);
  const globalUsed = count(await tx.getLedger(key.global, now));
  const { extra } = await readBonus(tx, key.bonus, now);
  return { ip: key.ip, day: key.day, expiresAt: nextMoscowDay(now), ipUsed, extra,
    ipLimit: IP_DAILY_LIMIT + extra, ipRemaining: Math.max(0, IP_DAILY_LIMIT + extra - ipUsed),
    globalUsed, globalLimit: GLOBAL_DAILY_LIMIT, globalRemaining: Math.max(0, GLOBAL_DAILY_LIMIT - globalUsed) };
}
export type DailyQuota = Awaited<ReturnType<typeof readDailyQuota>>;
export async function consumeDailyQuota(tx: GenerationTransaction, secret: string, ip: string, now: number, quota: DailyQuota) {
  const key = keys(secret, ip, now);
  await tx.putLedger(key.global, String(quota.globalUsed + 1), now + 2 * DAY);
  for (const counter of new Set([key.counter, key.legacy])) await tx.putLedger(counter, String(quota.ipUsed + 1), now + 2 * DAY);
}

export function createQuotaAdminService(store: GenerationStore, options: { secret: () => string; now?: () => number }) {
  const clock = options.now ?? Date.now;
  return {
    async inspect(ip: string): Promise<DailyQuota> {
      normalizeQuotaIp(ip); const now = clock(); const secret = options.secret();
      return store.transaction(tx => readDailyQuota(tx, secret, ip, now));
    },
    async grant(input: unknown, actorId: string): Promise<QuotaGrantReceipt> {
      const parsed = quotaGrantSchema.safeParse(input);
      if (!parsed.success || !actorId || actorId.length > 128) throw new GenerationError("invalid_argument");
      const body = parsed.data; const ip = normalizeQuotaIp(body.ip); const secret = options.secret(); const now = clock();
      const requestKey = `quota-grant:request:${generationDigest(secret, "quota-grant-request", body.requestId)}`;
      const fingerprint = generationDigest(secret, "quota-grant-input", JSON.stringify({ ip, amount: body.amount, day: body.day, actorId }));
      return store.transaction(async tx => {
        const previous = await tx.getLedger(requestKey, now);
        if (previous) {
          const saved = requestSchema.parse(JSON.parse(previous));
          if (saved.fingerprint !== fingerprint) throw new GenerationError("request_id_conflict");
          return saved.event.receipt;
        }
        if (body.day !== moscowDay(now)) throw new GenerationError("quota_day_changed");
        const key = keys(secret, ip, now); const bonus = await readBonus(tx, key.bonus, now);
        if (bonus.extra + body.amount > MAX_EXTRA_ATTEMPTS) throw new GenerationError("quota_grant_limit");
        const receipt: QuotaGrantReceipt = { requestId: body.requestId, day: body.day, amount: body.amount,
          totalExtra: bonus.extra + body.amount, grantedAt: new Date(now).toISOString(), expiresAt: nextMoscowDay(now) };
        const event = { actorId, receipt };
        // Only allowance and its audit/receipt are written. Budget, used counters, tasks,
        // scheduler and provider history never participate in this operation.
        await tx.putLedger(key.bonus, JSON.stringify({ extra: receipt.totalExtra, events: [...bonus.events, event] }), now + AUDIT_RETENTION);
        await tx.putLedger(requestKey, JSON.stringify({ fingerprint, event }), now + AUDIT_RETENTION);
        return receipt;
      });
    },
  };
}
