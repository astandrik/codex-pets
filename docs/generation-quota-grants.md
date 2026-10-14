# Additional generation attempts for an IP

Admin → Generation limits (`/admin/generation-limits`) lets an administrator check
an IP's daily allowance and issue a positive whole number of extra attempts.
There is no separate 30-attempt cap per grant or per IP per day; repeat grants
add to the allowance. Extra allowance expires at the next midnight in Moscow.
Values and accumulated totals must fit exact integer arithmetic.

A grant increases `10 + extra` for that IP. It never subtracts accepted tasks,
changes the service-wide cap of 200, or alters the $50 budget, spent amounts,
outstanding/unknown reservations, scheduler, deduplication or existing jobs.
Failed accepted tasks still count. A full global quota or exhausted budget can
therefore still block generation after an IP grant.

The admin API requires the existing admin session and same-origin checks:

- `POST /api/admin/generation-quotas` with `{ip}` reads counters. The IP is sent in
  the body, never in a URL/query string.
- `POST /api/admin/generation-quotas/grants` with `{ip, amount, day, requestId}`
  issues the allowance. `day` must match the currently observed Moscow day;
  `requestId` is a fresh UUID for one deliberate action. Reuse it unchanged after
  a timeout or lost response. A payload/administrator conflict returns 409.

Counter reads and allowance/audit/receipt writes use the existing serializable
YDB transaction and quota table. No schema migration is needed. The grant only
writes namespaced bonus and idempotency records. Grant history (administrator ID,
amount, time and receipt) is retained 30 days, with HMAC IP keys and no raw IP.
The existing usage/budget history retention is unchanged. A request replay after
midnight returns its original expired receipt; it never grants attempts for the
new day. The UI requires a refreshed quota/new deliberate action for that day.

IPv4/IPv6 input is validated, IPv6 is canonicalized for grants. Admission reads
both the canonical counter and the legacy spelling supplied by the trusted
origin, takes the higher consumed count and advances both without decrementing.
The admin form preserves the entered IP spelling for counter lookups, including existing IPv6 counters; it never replaces it with the normalized display value. For historical IPv6 usage, enter the exact spelling seen by the origin. The origin must continue to set `x-pets-client-ip` itself; arbitrary
`X-Forwarded-For` does not identify the quota. One NAT/MCP gateway shares one IP
allowance. Rotating the existing HMAC secret would invalidate quota identities
and is not part of this feature.

The form preserves its request ID through an unknown response using a browser
session receipt containing an input hash, UUID, amount, day and pending/completed state, not the raw IP. On reload an unconfirmed grant requires re-entering the original IP; changed input cannot replace its UUID. After a
confirmed result, `Issue another grant` explicitly starts a different operation. After reload, a fresh explicit confirmation also starts a new operation when the prior receipt was confirmed; unconfirmed receipts always retain their UUID.
New grants require browser session storage. The form has no Metrika/Webvisor,
noindex/no-referrer and private no-store responses. Never log request bodies or
HMAC secrets.

Public site/HTTP/MCP keep `code=rate_limited` and HTTP429. The additive
`limitScope` is `ip` or `global`; `retryAt` is the next Moscow midnight. If both
are exhausted, the global cap takes precedence. Older unspecified errors keep
the generic explanation. Budget errors remain `budget_exhausted`.

This feature does not expose admin quota writes through MCP. After a grant
exceeds 30, rollback requires a compatible reader for larger allowances and
receipts, including unconfirmed browser receipts. The previous strict schemas
cannot read these records. Retain a compatible rollback image; do not delete
quota rows, audit events, or receipts to roll back.
