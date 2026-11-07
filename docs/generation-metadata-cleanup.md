# Generation metadata recovery

The worker previously spread an image result into stage metadata. Its `bytes`
Buffer was serialized inside the job JSON as well as stored in the image artifact.
A queue read of several such jobs could exceed YDB's response-size limit.

The updated writer projects supported metadata fields. Queue expiration reads
only ID, status and expiry. The cleanup command removes verified duplicate
`stages[].bytes` from explicitly selected jobs and preserves the rest of the raw
JSON text, including unknown fields and integer literals.

## Prepare and inspect

Use the exact reviewed source with the intended YDB credentials. Prepare a private
operator directory (mode 0700). An IDs file is a JSON array of generation IDs.
For the first incident operation select only the original 25 jobs. Refresh their
state and expiry before application.

```sh
node scripts/clean-generation-metadata.mjs --ids-file=/private/operator/ids.json --manifest=/private/operator/manifest.json
```

Default execution is a dry-run. Each entry reports original/cleaned hashes,
expiry and removed bytes. A completed stage qualifies only when its Buffer is
well formed, equals the stored PNG, and matches the stage SHA-256. Missing,
expired, active or inconsistent jobs are skipped. No raw image or prompt content
is printed. An existing manifest file is never overwritten.

Other live records can be audited separately:

```sh
node scripts/clean-generation-metadata.mjs --scan --manifest=/private/operator/audit.json
```

## Apply and rollback

Before deploying the corrected reader or applying cleanup, stop admissions and
all worker claimers and verify that active operations have completed. Both the
reader change and cleanup can make queued work runnable. Keep the three historic
unknown calls and their accounting. Resume processing only under the operator's
separate authorization.

Review every manifest entry and use the `manifestSha256` printed by dry-run:

```sh
node scripts/clean-generation-metadata.mjs --apply --manifest=/private/operator/manifest.json --expected-manifest-sha256=HASH --backup=/private/operator/backup.json
```

The command creates and fsyncs a 0600 backup with the exact raw job JSON and
physical expiry values before the first update, then reads it back. Each row is
revalidated inside a serializable transaction, including lease/slot state and
artifact bytes and their native expiry. Immediately before updating `payload`,
the command checks the earliest deadline across the logical job expiry, native
row expiry and every verified artifact. The same check applies to restore. The first conflict stops the run;
earlier completed rows can be identified by their cleaned hashes. Repeating the
same command after a lost acknowledgement safely recognizes completed rows.

Do not edit the backup. To restore it during the same quiesced maintenance window:

```sh
node scripts/clean-generation-metadata.mjs --restore --manifest=/private/operator/manifest.json --expected-manifest-sha256=HASH --backup=/private/operator/backup.json
```

Restore requires an unexpired row still matching the cleaned hash and matching
artifacts. Newer work is never overwritten. Artifacts, scheduler, UUID receipts,
quotas and budget ledgers are never written by this command. Restoring duplicate
buffers may restore the oversized-read problem, so complete the operator's
rollback decision before resuming processing. Retain the private backup according
to the existing generation-data retention policy and delete it after recovery
acceptance. Restoring a backup always checks the original row expiry.

## Verification

Unit tests cover metadata projection, transaction aborts, stale actions, exact
JSON restoration, corrupt backups, expiry and replay. The opt-in real-YDB test
uses a fresh disposable database at `grpc://127.0.0.1:23136`, database `/local`:

```sh
PET_METADATA_YDB_INTEGRATION=1 YDB_PETS_ENDPOINT=grpc://127.0.0.1:23136 YDB_PETS_DATABASE=/local YDB_ANONYMOUS_CREDENTIALS=1 npm test -- --maxWorkers=1 src/lib/pets/generation/metadata-recovery-ydb.integration.test.ts
```

It creates its own tables and refuses to reuse existing tables. It reproduces
an oversized 25-job read, validates the projected reader, exercises cleanup and
rollback, and counts calls to a synthetic renderer. No live provider is used.
