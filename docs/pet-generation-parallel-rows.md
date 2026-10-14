# Eleven rows with recorded-spend accounting

The worker generates the base reference first, then requests the eleven animation
rows in one batch. One pet is active for the whole service, with up to five waiting
tasks. Model, prompts, image dimensions, twelve-image-stage maximum, English card
metadata and proxy routing are unchanged.

## Durable calls and diagnostics

Each stage intent is saved before its provider call. The worker checks ownership,
lease, enabled state and recorded spend before sending. Results save serially to
avoid conflicts on the job and accounting record, while provider calls run in
parallel. All sibling calls settle before failure finalization or workspace
cleanup. Successful rows are retained even if another row fails.

A lost commit acknowledgement is resolved by reading the saved stage and hash.
A confirmed RemoteDisconnected may receive one delayed retry for the same failed stage, as described below. Other unknown outcomes are never automatically retried. Safe private failure
diagnostics distinguish process, report, image, checkpoint and lease failures;
raw prompts, images, provider bodies and stderr are not diagnostic fields.

## No monetary reservations

The service does not reserve money at admission, before image calls, or before
card metadata. It stops accepting tasks or authorizing calls when recorded spend
for the Moscow day reaches the configured threshold (normally $50). Already-sent
calls can finish above that amount, and unavailable provider usage is not assumed
to be zero cost. This is a recorded-spend threshold, not a hard spending cap.

The existing `budget.reservations` JSON field remains for compatible storage:
new entries contain `remainingMicroUsd: 0` and an `unknown` accounting flag.
No per-call monetary hold map is created. A terminal known result removes its
tracking entry; an unknown outcome retains its zero-balance marker across job
TTL and midnight. Stage records and request hashes enforce no-replay behavior.

Clearing historical holds requires an explicit, audited operation; deploying
code does not erase old accounting evidence. Preserve recorded expenses, daily
attempt counters, grant receipts, failed jobs and a receipt for any released
unknown balance. Unknown outcomes still pause the service until reviewed.

The card request remains sequential and keeps its existing input-size and
estimated request-cost bounds; those checks allocate no money from the daily
budget. There is no smaller-batch fallback to fit monetary reservations.

## Release and rollback

Deploy compatible no-reservation code to both web and worker while the scheduler
is paused and no call is active. Keep a six-row worker built from the same new
accounting code as the concurrency rollback; the web can remain on the compatible
release. Previous reservation-based images require explicit accounting
reconciliation before reuse, not a blind rollback after new jobs have run.

Use isolated YDB tables and network-disabled synthetic provider responses to
verify eleven concurrent processes under the existing CPU and memory limits.
Never run old and new active workers together or force-kill an in-progress paid
call. Release historical holds and clear the inspected pause transactionally only
after runtime acceptance, retaining a receipt and exact readback evidence.

This scheduling change removes one image wave compared with six plus five rows;
it is not a measured production speedup. All eleven calls may already be sent
when one row fails, so a failed task can pay for five more rows than before.

## One delayed connection-closure retry

A failed image stage whose CLI cause is `remote_disconnected` gets at most one
retry, after five seconds. Successful rows are not called again. The base image
is also an image stage: the maximum is therefore 24 image calls for 12 stages,
plus one card-metadata request. Metadata, moderation refusals, malformed output,
unknown exception types and database/checkpoint errors are not retried.

The first failure, cleaned exception chain and traceback frames are persisted
privately. A unique retry token and earliest start time are written before the
wait; the token is consumed transactionally before the second call. Both steps
check ownership, lease, enablement, pause and the recorded-spend threshold.
Unconfirmed writes never justify another provider call. An interrupted retry is
not resumed after a worker restart; the existing uncertain-intent protection
remains in force. All writes for a batch share its serial checkpoint queue.

A failed first call can already have been billed. Its unknown accounting marker
survives even when the second call succeeds; no zero-cost assumption or monetary
reserve is introduced. A second failure stops the task and preserves the normal
global guard. Existing terminal failed jobs are never reopened automatically.

`rowAttemptLogs` and `rowRetries` are private job fields bounded to 24 failures
and 12 retry markers. Error text is reduced to fixed technical messages; stack
frames retain only code basenames, function names and line numbers, without
source lines, locals, URLs, headers, prompt text, provider bodies or credentials.
Logs expire with the existing private job retention. Deploy web readers together
with the worker so subsequent metadata edits preserve the private audit fields.
