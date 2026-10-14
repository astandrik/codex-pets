"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Alert, Button, Dialog, Flex, TextInput } from "@gravity-ui/uikit";
import type { DailyQuota, QuotaGrantReceipt } from "@/lib/pets/generation/quota-grants";
import { MAX_EXTRA_ATTEMPTS } from "@/lib/pets/generation/quota-limits";
import { withBasePath } from "@/lib/base-path";
import { GRANT_STORAGE_KEY, prepareQuotaGrant, completeQuotaGrant, readPendingQuotaGrant } from "./request";
import "./AdminGenerationQuotas.scss";

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "Admin sign-in required.", invalid_origin: "Open this action from the Pets admin page.",
  invalid_argument: "Enter a valid IP address and a positive whole number of attempts.",
  quota_day_changed: "The Moscow day changed. Check the quota again before issuing a new grant.",
  quota_grant_limit: "The total allowance is too large. Enter a smaller number of attempts.",
  request_id_conflict: "This grant ID was used with different input. Check its receipt before starting another grant.",
};
function message(body: unknown) {
  const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : '';
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : "Could not confirm the operation. Retry the same grant to avoid double credit.";

}
function expiry(value: string) {
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/Moscow' }) + ' Moscow time';
}
async function postQuotaRequest(path: string, body: object) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(withBasePath(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal });
    return { response, body: await response.json() };
  }
  finally {
    clearTimeout(timer);
  }

}

const subscribe = () => () => {
};
export function AdminGenerationQuotas() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  return ready ? <QuotaForm /> : <p>Loading generation limits…</p>;

}
function QuotaForm() {
  const [initial] = useState(() => {
    try {
      return { saved: readPendingQuotaGrant(sessionStorage), error: "" };

    }
    catch {
      return { saved: null, error: "Saved grant receipt is unreadable. Check the server audit before creating another grant." };

    }

  });
  const [ip, setIp] = useState('');
  const [amount, setAmount] = useState(String(initial.saved?.amount ?? 1));
  const [quota, setQuota] = useState<DailyQuota | null>(null);
  const [receipt, setReceipt] = useState<QuotaGrantReceipt | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof prepareQuotaGrant>> | null>(null);
  const [restored, setRestored] = useState<ReturnType<typeof readPendingQuotaGrant>>(initial.saved);
  const storageError = Boolean(initial.error);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const running = useRef(false);
  const inputVersion = useRef(0);
  const validAmount = Number.isSafeInteger(Number(amount)) && Number(amount) >= 1 && Number(amount) <= MAX_EXTRA_ATTEMPTS;

  async function lookup() {
    if (running.current || !ip.trim() || pending) return;
    running.current = true;
    setBusy(true);
    setError('');
    const version = inputVersion.current;
    try {
      const result = await postQuotaRequest('/api/admin/generation-quotas', { ip: ip.trim() });
      if (version !== inputVersion.current) return;
      if (!result.response.ok) {
        setError(message(result.body));
        return;
      }
      setQuota(result.body.quota);
      setReceipt(null);

    } catch {
      if (version === inputVersion.current) setError('Could not read the quota. Check your connection and sign-in.');
    }
    finally {
      running.current = false;
      setBusy(false);
    }

  }
  async function grant() {
    if (running.current || !quota || !validAmount || storageError) return;
    running.current = true;
    setBusy(true);
    setError('');
    setConfirm(false);
    try {
      const input = pending ?? await prepareQuotaGrant(sessionStorage, { ip: ip.trim(), amount: Number(amount), day: restored?.day ?? quota.day });
      setPending(input);
      const result = await postQuotaRequest('/api/admin/generation-quotas/grants', input);
      if (!result.response.ok) {
        setError(message(result.body));
        if (['quota_day_changed', 'quota_grant_limit'].includes(result.body?.code)) {
          completeQuotaGrant(sessionStorage, input.requestId);
          setRestored(null);
          setPending(null);
          if (result.body.code === 'quota_day_changed') setQuota(null);

        }
        return;

      }
      if (!result.body.receipt || !result.body.quota) throw Error('unconfirmed_response');
      completeQuotaGrant(sessionStorage, input.requestId);
      setReceipt(result.body.receipt);
      setQuota(result.body.quota);
      setPending(null);
      setRestored(null);

    } catch (error) {
      if (error instanceof Error && error.message === 'pending_grant_mismatch') {
        setError('This does not match the unconfirmed grant. Enter the original IP and retry the same grant.');
        return;
      }
      setError('Could not confirm the grant. Retry the same grant; if the response was lost it will return the original receipt. Browser session storage must be available.');
    }
    finally {
      running.current = false;
      setBusy(false);
    }

  }
  function another() {
    try {
      sessionStorage.removeItem(GRANT_STORAGE_KEY);
    } catch {
      setError('Enable browser session storage before starting another grant.');
      return;
    }
    setReceipt(null);
    setQuota(null);
    setAmount('1');
    setError('');

  }
  return <Flex direction="column" gap={4} className="admin-generation-quotas">
    <p>Additional attempts apply only to this IP until midnight Moscow time. The service cap of 200 accepted tasks/day and the $50 spending/reservations limit still apply.</p>
    {restored&&<Alert theme="warning" title="Unconfirmed grant" message={`A grant of ${restored.amount} attempts for ${restored.day} is unconfirmed. Re-enter the original IP to read its quota and retry the same grant; no new grant ID will be created.`}/>}
    <form onSubmit={e=>{e.preventDefault();void lookup();}}>
      <label htmlFor="quota-ip">IP address</label>
      <TextInput id="quota-ip" value={ip} autoComplete="off" disabled={busy||Boolean(pending)||Boolean(receipt)} placeholder="203.0.113.5 or 2001:db8::5"
        onUpdate={value=>{inputVersion.current++;setIp(value);setQuota(null);setError('');}} />
      <Button type="submit" view="outlined" disabled={busy||Boolean(pending)||Boolean(receipt)||!ip.trim()}>Check quota</Button>
    </form>
    {quota&&<>
      <dl><dt>IP: accepted / allowed today</dt><dd>{quota.ipUsed} / {quota.ipLimit} ({quota.extra} additional)</dd>
        <dt>Whole service: accepted / allowed today</dt><dd>{quota.globalUsed} / {quota.globalLimit}</dd>
        <dt>IP attempts remaining</dt><dd>{quota.ipRemaining}</dd><dt>Expires</dt><dd>{expiry(quota.expiresAt)}</dd></dl>
      {quota.globalRemaining===0&&<Alert theme="warning" message="The whole-service daily limit is reached. Extra IP attempts cannot bypass it." />}
      {!receipt&&<><label htmlFor="quota-amount">Additional attempts</label>
        <TextInput id="quota-amount" type="number" value={amount} disabled={busy||Boolean(pending)||Boolean(restored)} onUpdate={setAmount}/>
        {pending||restored?<Button view="action" disabled={storageError} loading={busy} onClick={()=>void grant()}>Retry same grant</Button>
          :<Button view="action" disabled={busy||!validAmount||storageError} onClick={()=>setConfirm(true)}>Review grant</Button>}</>}
    </>}
    {receipt&&<><Alert theme="success" title={`${receipt.amount} additional attempts granted`} message={`Total additional allowance: ${receipt.totalExtra}. Valid until ${expiry(receipt.expiresAt)}. No counters were reset.`}/>
      <Button view="outlined" onClick={another}>Issue another grant</Button></>}
    {error&&<Alert theme="danger" message={error}/>}
    <p>Budget and expense history are never reset. Accepted tasks, including failed generations, remain counted. The server records the administrator, time and grant receipt; IP addresses are stored only as HMACs.</p>
    <Dialog open={confirm} onClose={()=>!busy&&setConfirm(false)} size="s">
      <Dialog.Header caption="Grant additional attempts"/>
      <Dialog.Body><p>Add {amount} attempts for <strong>{quota?.ip}</strong> until {quota&&expiry(quota.expiresAt)}?</p>
        <p>This increases only the IP allowance. Budget, global usage and expense history remain unchanged.</p></Dialog.Body>
      <Dialog.Footer textButtonApply="Grant attempts" textButtonCancel="Cancel" onClickButtonApply={()=>void grant()} onClickButtonCancel={()=>setConfirm(false)} propsButtonApply={{loading:busy,view:'action'}}/>
    </Dialog>
  </Flex>;
}
