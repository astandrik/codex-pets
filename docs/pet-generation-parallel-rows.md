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
Captured RemoteDisconnected, IncompleteRead, HTTP 500 and HTTP 520 failures may receive one delayed retry for the same failed stage, as described below. Other unknown outcomes are not automatically retried. Safe private failure
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
unknown balance. Unclassified outcomes and uncertain storage/lease transitions still pause the service until reviewed.

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

## Local extraction fallback

After a normal extraction fails with a component-count error, the renderer can
separate lightly touching poses in those failed strips. It uses projection to
locate gaps, then follows a narrow contour through background and dark outlines.
Successful strips and the saved stage images remain unchanged. This is local
image processing: it never requests another image or reopens a failed job.

Recovery rejects unrelated errors and warnings, more than 24 foreground pixels
cut at any one boundary (also capped at 6% of the shorter adjacent pose's height), or total cuts above
0.1% of foreground pixels. The resulting poses must have the expected count,
substantial and comparable areas/heights, and positions consistent with the
requested slots. These conservative checks cannot reconstruct occluded details.
All candidate strips must pass before any derived raw strip is replaced.

The renderer retries local extraction once, then runs the unchanged manifest,
atlas and package checks. Missing poses and substantial overlap remain failures.
Work is bounded to the existing eleven strips, at most 1536x512 pixels and eight
frames per strip. Run the offline Python contracts with the pinned dependencies:
`python3 -m unittest discover -s scripts/pet-spritegen -p 'test_*.py'`.

## One delayed provider retry

A failed image stage with a captured RemoteDisconnected, IncompleteRead, HTTP 500
or HTTP 520 cause gets at most one retry, after five seconds. Successful rows are not called again. The base image
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
reserve is introduced. A second failure stops the task. Once every unresolved stage has a matching
persisted provider failure and finalization commits atomically, later tasks can
continue. Missing records, uncertain writes and lost leases retain the global pause. Existing terminal failed jobs are never reopened automatically.

`rowAttemptLogs` and `rowRetries` are private job fields bounded to 24 failures
and 12 retry markers. Error text is reduced to fixed technical messages; stack
frames retain only code basenames, function names and line numbers, without
source lines, locals, URLs, headers, prompt text, provider bodies or credentials.
Logs expire with the existing private job retention. Deploy web readers together
with the worker so subsequent metadata edits preserve the private audit fields.

## Website character review and image references

`PET_GENERATION_REVIEW_FLOW_ENABLED=true` enables the new website flow. It is off
by default and affects admission only. New website tasks accept text, one static
PNG/JPEG/WebP reference, or both, and stop after the saved base character. The
reference defines appearance; optional text changes only explicitly named details.
The user confirms the base before the eleven animation rows and metadata request.
JSON and MCP admissions keep their automatic behavior regardless of this flag.
Existing jobs retain the policy saved at admission.

All review-form submissions use multipart, including text without an image. This
preserves review intent if the flag is disabled while the form is open: new review
requests are rejected, while retries of already accepted requests return the same
job. Legacy forms continue to send JSON. Multipart text is normalized to LF before
length validation and fingerprinting. Replays also recognize the original CRLF
fingerprint of already accepted multipart requests; stored records are not rewritten.
JSON and MCP text fingerprints remain unchanged. Deploy compatible web readers
together: an old web instance cannot replay newly normalized multipart records.
Disabling new review admission does not remove the need for compatible readers.

The upload limit is 5 MiB, with a 6 MiB streamed multipart limit and a 25-million
pixel decoding limit. The server rotates, strips metadata and normalizes the image
to PNG, at most 1024 pixels on its long side, without cropping or enlargement.
Reference bytes and the job are committed together. Raw-image hash participates in
idempotency; normalized-image hash protects the saved artifact. The reference is
private, expires with the job, and is never copied into gallery assets or the ZIP.

A review job releases its worker lease and scheduler slot while awaiting approval.
Confirmation queues the same job once, reuses its base and starts a fresh 30-minute
queue clock. It consumes no new daily attempt and preserves recorded expenses and
unknown accounting markers. The original 24-hour expiry never moves. An explicit
new attempt creates a new job and consumes another daily attempt; refreshing or
retrying an interrupted request does not. Confirmation is not an automatic retry
of a failed or expired task.

`GET /api/pet-generations/{id}/base` exposes only the saved base PNG.
`POST /api/pet-generations/{id}/confirm` returns 202 for the first queued
confirmation, or 200 for a previously confirmed job. Queue or budget rejection
leaves the base waiting. Both endpoints keep the existing private-capability
model; confirmation also requires the same-origin check. Never share the task URL.

Before enabling the flag, deploy compatible web readers and workers and drain all
old workers. Old code can ignore new job fields and must not claim review jobs.
To roll back, disable new review admission and retain compatible readers/workers
until existing review jobs complete or expire. Disabling the flag must not prevent
confirmation of existing jobs. This change needs no YDB schema migration.


### Text refinement of a saved base

Before confirming a character, **Edit character** accepts a text-only change such
as “keep everything else, but make the scarf red”. The saved base is the reference,
not the original upload. Each accepted refinement creates an independent review
job through the same queue, daily quota and budget checks. It consumes one ordinary
attempt, gets its own24-hour expiry and stops before animations. The previous
version and its original expiry/costs remain unchanged. Its user-supplied name is
inherited; automatic naming remains automatic.

`POST /api/pet-generations/{id}/refine` takes strict JSON `{prompt, requestId}`,
requires the browser Origin and trusted client IP, and returns `{generation}`/202.
The prompt is required, normalized to LF, trimmed and limited to2000characters;
the body is limited to16KiB. New admission requires review enabled and a live
`awaiting_confirmation` source. The source job/base integrity check, normalized
reference copy, new job, quota, budget and queue writes share one transaction.
The source ID participates in request identity. Replay checks deduplication before
reading the source, so accepted requests survive source expiry or flag rollback.
A final source-expiry check rolls back admission if database work crosses its deadline.

Stored renderer PNGs may be up to8MiB; their private references are fully decoded,
resized to at most1024pixels on the long side and kept under5MiB. Public uploads
retain their5MiB input limit. Original references are never returned or published.
No prompts or image bytes are placed in browser storage; request identity stores
only a hash, UUID and expiry under a key derived from the source ID. Other forms
cannot replace that pending identity. An unresolved refinement also cannot be
replaced by different text for the same source. Transport failures, server errors
and invalid receipts keep the submitted request pinned; a definitive admission
rejection after dedup allows editing again. Origin/body rejections happen before
dedup and cannot settle an earlier uncertain request. Replays do not extend the
saved request deadline.
After a lost response, cancellation or page reload, **Recover submitted edit** is
available even while the source is live or has expired locally without a status
refresh. Re-entering the
exact text checks its hash and replays the saved UUID; a mismatch or missing
identity cannot start a new attempt. Successful refinement navigates to the new private
result with a validated `from` capability hint for comparison/return navigation.
That hint is not an authorization decision and never appears in gallery assets.
Both jobs are retained in the existing local history. If saving the new version
fails, the editor shows its private link and a warning instead of navigating away;
it retains the recovery identity so the accepted result can still be retrieved. Confirmation always targets
the displayed new job; reopening the previous version can confirm that one instead.

Existing jobs and MCP/JSON text admissions do not change. This feature needs no
schema migration or new provider integration. Deploy the compatible web endpoint
and UI together; the existing reference-aware worker already processes the new
jobs. Disabling new review admission keeps accepted refinement retries and
confirmation available.

After accepting refinements, a rollback must retain a web version with the
`/refine` handler and its request replay support. Turning review admission off on
that compatible version is safe; restoring a pre-refinement web image can strand
an accepted request whose response was lost, even though its worker job is valid.
The existing reference-aware worker does not need a new job schema.
