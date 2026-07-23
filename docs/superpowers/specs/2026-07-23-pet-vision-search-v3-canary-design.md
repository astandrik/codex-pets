# Structured Vision v3 Canary Design

**Status:** Frozen for implementation after review

**Date:** 2026-07-23

**Scope:** Add a structured visual-caption v3 contract and a four-pet canary
gate. This phase ends when four fresh v3 caption/vector rows pass the durable
gate; it does not change production search.

## Decision

V3 is a new, isolated caption/vector revision. It keeps all v1/v2 rows,
contracts, four-frame extraction, provider transport controls, and search
behavior immutable. The provider must return required, bilingual,
presence-aware visual-attribute slots. A canary-only CLI mode validates all
four predetermined pets and creates their captions and embeddings before any
write.

The frozen identifiers are:

| Item | Value |
| --- | --- |
| Caption revision | `yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3` |
| Visual revision | `yandex-text-search-2026-07-pet-vision-v3` |
| Envelope schema version | `3` |
| Provider schema name | `pet_visual_caption_v3` |
| Vector dimensions | `256` |
| Calibration profile | `null` |
| Frame policy | `pet-vision-central-frames-v1` |

`profile: null` keeps visual hybrid unavailable: v3 must fail closed to the
existing text-hybrid path until a later, separately approved calibration and
cutover. V1 and v2 remain selectable only through their existing matching
caption/vector revision pairs; v3 rows never overwrite or mix with them.

## Architecture and contracts

The existing vision-caption registry gains v3 alongside immutable v1 and v2
definitions. Its caption object retains the existing required subject,
appearance, style, mood, color, and search-term fields, and replaces no
existing data. It additionally requires `visual_attributes`, a strict object
with exactly these fixed-order slots:

1. `hair_and_headwear`
2. `face_and_eye_coverings`
3. `clothing_and_armor`
4. `weapons_and_objects`
5. `visible_effects`
6. `other_distinguishing_features`

Every slot has this exact shape:

```json
{ "present": true, "en": "normalized English description", "ru": "нормализованное русское описание" }
```

The provider JSON schema makes every slot and all three fields required and
disallows additional properties. Manual parser validation is stricter than the
schema: after the normal Unicode NFKC, whitespace-collapse, trim, and length
validation, `present: true` requires non-empty `en` and `ru`; `present: false`
requires both normalized strings to be empty. English and Russian remain
semantic equivalents. No boolean or inferred identity can enter indexed text.

Canonical embedding text retains its established v3-independent ordering for
the base caption fields and adds only the following lines after
subject/appearance and before style/mood/colors/search terms:

```text
hair_and_headwear_en
hair_and_headwear_ru
face_and_eye_coverings_en
face_and_eye_coverings_ru
clothing_and_armor_en
clothing_and_armor_ru
weapons_and_objects_en
weapons_and_objects_ru
visible_effects_en
visible_effects_ru
other_distinguishing_features_en
other_distinguishing_features_ru
```

These lines contain the normalized strings only; canonical text never includes
`present`, `true`, `false`, or another boolean marker. Existing hashing stays
length-prefixed SHA-256, with the v3 revision, contract/prompt, source image
identity, and canonical text participating in the appropriate caption and
vector freshness hashes.

## Provider and data flow

For each selected pet, read the existing spritesheet, hash it, and extract
exactly four in-memory data URLs, labelled and ordered `idle`,
`running-right`, `waving`, `review`. Send those four URLs and those state labels
to the provider; send no catalog metadata, identity, name, tags, description,
or provenance. The prompt continues to require visible evidence only and no
identity inference.

The v3 request changes only `max_tokens` to `1200` and selects the v3 strict
schema. The existing timeout bounds, scheduler/rate limiting, retry policy,
provider error classification, credential handling, and log redaction remain
unchanged. Logs must never include images, prompts, captions, catalog fields,
or provenance.

After strict parsing and canonicalization, create a 256-dimensional document
embedding from canonical text. The caption row is keyed by the v3 caption
revision and pet slug; the vector row is keyed by the v3 visual revision and
pet slug. No Qdrant or image-embedding path is introduced.

## Slot-aware canary gate

`--canaries` selects exactly these four approved slugs and no others. Its
quality checks inspect the specified slot's English/Russian normalized text,
not an unrestricted whole-caption substring:

| Slug | Required checks |
| --- | --- |
| `fischl-detailed` | blonde hair in `hair_and_headwear`; dark eye covering in `face_and_eye_coverings`; purple and dark/black concepts independently in `clothing_and_armor` |
| `2b-2` | silver hair in `hair_and_headwear`; dark eye covering in `face_and_eye_coverings`; black/dark clothing in `clothing_and_armor`; sword in `weapons_and_objects` |
| `master-of-terra` | golden armor and red cloak independently in `clothing_and_armor`; sword in `weapons_and_objects`; fire/flame/burning concept in `visible_effects` |
| `vi` | magenta/pink hair in `hair_and_headwear`; oversized/massive gauntlets in `weapons_and_objects` |

Each check requires the named slot to have `present: true`. English terms are
matched only against that slot's `en` text and Russian terms only against its
`ru` text. The check passes when at least one English term **or** at least one
Russian term matches; it does not require both languages to use the same
phrase. Inputs and terms are normalized with NFKC, locale-independent
lowercase, non-letter/non-number runs replaced by one space, collapsed
whitespace, and trimming. Multi-token terms use normalized substring matching;
single-token terms must equal a normalized whitespace-delimited token.

The accepted terms are frozen per check:

| Canary/check | English terms | Russian terms |
| --- | --- | --- |
| `fischl-detailed/blonde_hair` | `blonde hair`; `blond hair`; `fair hair` | `белокурые волосы`; `светлые волосы`; `волосы блонд` |
| `fischl-detailed/dark_eye_covering` | `dark eye covering`; `black eye covering`; `dark eye patch`; `black eye patch`; `dark eyepatch`; `black eyepatch`; `dark blindfold`; `black blindfold` | `чёрная повязка на глаз`; `черная повязка на глаз`; `тёмная повязка на глаз`; `темная повязка на глаз`; `чёрная повязка`; `черная повязка`; `тёмная повязка`; `темная повязка` |
| `fischl-detailed/purple_outfit` | `purple outfit`; `violet outfit`; `purple clothing`; `violet clothing`; `purple dress` | `фиолетовый наряд`; `фиолетовая одежда`; `фиолетовое платье`; `пурпурный наряд` |
| `fischl-detailed/dark_outfit` | `black outfit`; `dark outfit`; `black clothing`; `dark clothing`; `black dress` | `чёрный наряд`; `черный наряд`; `тёмный наряд`; `темный наряд`; `чёрная одежда`; `черная одежда`; `чёрное платье`; `черное платье` |
| `2b-2/silver_hair` | `silver hair`; `silver white hair`; `white silver hair` | `серебристые волосы`; `серебряные волосы`; `серебристо белые волосы` |
| `2b-2/dark_eye_covering` | `dark eye covering`; `black eye covering`; `dark eye patch`; `black eye patch`; `dark eyepatch`; `black eyepatch`; `dark blindfold`; `black blindfold` | `чёрная повязка на глаз`; `черная повязка на глаз`; `тёмная повязка на глаз`; `темная повязка на глаз`; `чёрная повязка`; `черная повязка`; `тёмная повязка`; `темная повязка` |
| `2b-2/dark_outfit` | `black outfit`; `dark outfit`; `black clothing`; `dark clothing`; `black dress` | `чёрный наряд`; `черный наряд`; `тёмный наряд`; `темный наряд`; `чёрная одежда`; `черная одежда`; `чёрное платье`; `черное платье` |
| `2b-2/sword` | `sword`; `blade`; `katana` | `меч`; `клинок`; `катана` |
| `master-of-terra/golden_armor` | `golden armor`; `gold armor`; `ornate golden armour` | `золотая броня`; `золотые доспехи` |
| `master-of-terra/red_cloak` | `red cloak`; `red cape`; `red mantle` | `красный плащ`; `красная мантия`; `красная накидка` |
| `master-of-terra/sword` | `sword`; `blade` | `меч`; `клинок` |
| `master-of-terra/flame_effect` | `fire`; `flame`; `flames`; `burning`; `fiery` | `огонь`; `пламя`; `горящий`; `пылающий`; `огненный` |
| `vi/magenta_hair` | `magenta hair`; `fuchsia hair`; `pink hair` | `пурпурные волосы`; `малиновые волосы`; `розовые волосы` |
| `vi/oversized_gauntlets` | `oversized gauntlets`; `massive gauntlets`; `huge gauntlets`; `large gauntlets`; `oversized mechanical gauntlets` | `массивные перчатки`; `огромные перчатки`; `большие рукавицы`; `массивные рукавицы` |

A canary diagnostic is limited to:

```json
{ "slug": "...", "passed": false, "checks": [{ "id": "...", "passed": false }] }
```

No caption text, expected terms, provider data, or source provenance appears
in diagnostics. A missing canary pet or stale/invalid stored caption is a
failed check, not a bypass.

## CLI and persistence semantics

The CLI accepts `--canaries` only for v3. `--dry-run --canaries` reads,
hashes, and extracts each selected spritesheet only; it makes no provider call
and performs no database write. It may report sanitized planned work.

`--apply [--force] --canaries` is a two-stage operation:

1. For all four pets, prepare fresh captions (or validate fresh rows when not
   forced), run every slot-aware check, construct canonical text, request and
   validate every 256-dimensional embedding, and stage all caption/vector
   payloads in memory.
2. Only after all four succeed, upsert their caption and vector rows.

Any attribute parse/validation, provider, embedding, or canary failure before
the persistence stage writes nothing. A YDB error during the second stage can
leave partial rows, but does not open the durable gate. After a successful
write stage, read back all four v3 caption rows and require each to be fresh,
valid, and canary-passing before recording the durable gate as passed.

V3 rejects `--apply --slug fischl-detailed` (and the equivalent command for
each other canary, with or without `--force`) so no individual canary can
establish the gate. Until the durable four-caption gate
passes, block v3 non-canary single-pet and full-catalog backfills, plus any
approval refresh that would make v3 eligible for use. V1/v2 maintenance keeps
its current behavior. The gate is revision-specific and is not satisfied by
rows from another revision or a merely in-memory pass.

## Failure handling, rollout, and rollback

A failed v3 canary freezes v3: retain its rows only as diagnostic evidence,
keep visual mode off/shadow and calibration null, and do not tune or retry
until lucky. The next design must be v4 and use a deterministic detail crop;
it may not mutate the v3 prompt, schema, terms, or gate after observing a
failure.

Success means only four fresh v3 caption/vector canary rows and a closed-loop
durable caption gate. It authorizes neither full-catalog backfill nor visual
search. Full backfill, new `visual-calibration-v3` and `visual-holdout-v3`,
labels, calibration, and production cutover are explicitly deferred. External
candidate, provider, and YDB actions require a later explicit confirmation.

Rollback is configuration-only: keep v3 unselected (or visual mode `off` /
`shadow`) and continue using immutable v1/v2 registrations. No migration or
deletion is required. This phase makes no public DTO, Qdrant, image embedding,
frame-policy, nginx/topology/auth/volume, or production-cutover change.

## Verification plan

Implementation must add focused contract/config/client coverage for the v3
registry, strict slot parser, canonical order without booleans, request schema
and `max_tokens: 1200`, and revision/config fail-closed behavior. Canary,
runtime, and CLI suites must prove exact selection, dry-run no-provider/no-write
behavior, stage-before-write atomicity for pre-persistence failures, rejected
single-canary apply, sanitized diagnostics, partial-YDB durable-gate closure,
and blocked non-canary/approval paths until readback passes.

Run the focused contract/config/client and canary/runtime/CLI suites, then:

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```
