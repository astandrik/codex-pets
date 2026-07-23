# Codex Pets Vision Search Remediation Design

**Status:** Awaiting review of the written specification

**Date:** 2026-07-23

**Scope:** Improve caption completeness and replace the exposed evaluation split without changing the four-frame policy, public contracts, or production ordering

## Context

The first vision-assisted search implementation is complete on
`codex/hybrid-pet-search` at commit
`4aeaf8b99610e62f16f7ae28d1b728db90c161d5`. The additive captions table is
present in YDB, and all 137 approved pets have a v1 caption and visual vector.
The exact candidate image runs privately with base text search in `hybrid` and
visual search in `shadow`.

Production was not cut over because the one-time v1 holdout failed the
predefined quality gates:

- text-hybrid nDCG@5 was `0.6`, equal to lexical nDCG@5, for a `0%` lift;
- visual-subset combined nDCG@5 was `0.5`, equal to text-hybrid nDCG@5, for a
  `0%` lift;
- exact-name MRR@5 remained `1.0`;
- combined overall nDCG@5 did not regress;
- negative-query safety, HTTP fallback contracts, public-contract privacy, and
  p95 latency of `331.5 ms` passed.

The exact combined `sexy` top five was:

1. `nozomi-2`
2. `jinx-2`
3. `ashe-2`
4. `anime-elf-girl`
5. `yuffie-3`

The user explicitly confirmed this list as relevant. That review is evidence
for the v1 result only; a changed v2 result requires another review.

## Root-cause evidence

The failed holdout exposed three independent problems.

### Caption completeness

The selected frames for `fischl-detailed` visibly include blonde hair, a dark
covering over one eye, and a purple-black outfit. The stored v1 caption contains
`blonde` but contains neither `eyepatch`, `eye patch`, nor an equivalent Russian
term. Consequently, its visual document vector cannot reliably satisfy the
query `blonde woman with eyepatch`.

The v1 schema has no dedicated field that forces the model to inspect and
record small distinguishing accessories. Strengthening ranking weights cannot
recover information absent from the indexed document.

### Incomplete subjective labels

For `badass`, the visual rank promoted `armored-anime-girl`, `2b-2`, and
`noir`, while the frozen relevant set contained only `vi`, `jinx-2`,
`master-of-terra`, and `primaris`. The promoted pets are plausible candidates
for this subjective query. A narrow relevant set can therefore penalize a
useful visual signal.

Future subjective fixtures require pooled, blinded human judgments rather than
an assumed exhaustive slug list.

### Calibration and gate mismatch

The v1 calibration function accepted any profile that preserved exact matches,
negative safety, overall text-hybrid non-regression, and one relevant `sexy`
result. It did not require the `15%` visual-subset lift demanded by rollout.
The selected profile achieved only `9.8%` visual-subset lift on calibration and
then `0%` on holdout.

The v1 holdout was also too small and too visually concentrated to serve as a
stable independent measurement of the existing text-hybrid `20%` lift gate.
The base text regression gate and the visual incremental-lift gate need
separate, appropriately stratified suites.

## Decision

Use a new caption and visual-vector revision with:

- the same four original `192 x 208` full-frame images;
- no resize, enhancement, face crop, or fifth image;
- a stricter provider instruction;
- a required bilingual `accessories` field;
- unchanged weighted RRF;
- stronger calibration acceptance;
- new blinded human labels and a new untouched holdout.

The remediation intentionally changes indexed visual text before changing the
ranking algorithm. This isolates document-quality improvement from fusion
behavior and preserves the smallest reversible architecture.

## Alternatives considered

### Prompt-only v2

This is the smallest code change, but the existing schema still permits the
model to omit small accessories entirely. It does not make completeness
testable, so it is rejected.

### Prompt plus structured accessories field

This is the selected approach. It preserves all image and runtime boundaries
while making the missing attribute class explicit in provider validation,
canonical text, hashes, canaries, and tests.

### Additional detail crop or image embedding

A face/detail crop could improve small-feature recall, and a native image
embedding model could avoid caption loss. Both alter the approved v1 frame or
model architecture and add new calibration variables. They remain follow-up
options only if the structured v2 canaries fail before full backfill.

## Revision contracts

### Unchanged frame policy

Keep the immutable frame policy:

```text
pet-vision-central-frames-v1
```

It continues to send exactly four lossless PNG data URLs in this order:

1. `idle`
2. `running-right`
3. `waving`
4. `review`

All existing atlas validation, source spritesheet hashing, in-memory extraction,
and no-filesystem-write behavior remains unchanged.

### Caption revision

Add this application revision:

```text
yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2
```

The v2 revision freezes the existing model URI and frame policy together with
the new prompt, JSON Schema, parser, canonical text order, and envelope schema
version.

Keep the v1 registry entry for rollback compatibility. A configured revision
selects exactly one schema and canonicalizer; v1 and v2 rows are never mixed.

### Visual-vector revision

Add this visual embedding revision:

```text
yandex-text-search-2026-07-pet-vision-v2
```

It remains a 256-dimensional `text-search-doc` vector generated from canonical
caption text. The v2 registry starts with `profile: null`. Visual `hybrid` must
therefore fail closed to text-hybrid with
`visual_calibration_missing` until a passing profile is committed.

The existing caption and embedding tables require no schema migration. New rows
are isolated by their revision primary-key prefixes. V1 rows may remain for
rollback and do not participate in v2 search.

## Provider contract v2

### System instruction

Use this exact v2 system instruction:

```text
You create internal search metadata for an animated software companion from four sprite frames. Inspect every frame before answering and describe only visible evidence. Explicitly check the face and eyes, hair and headwear, clothing, handheld or worn objects, weapons, masks or other face and eye coverings, jewelry, horns, wings, tails, and other distinguishing accessories. Put every visible distinguishing object or covering in accessories even if it also appears in appearance or clothing. If a small detail is uncertain, describe it cautiously instead of inferring identity. Do not infer or use a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing, accessories, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.
```

The user instruction, model URI, temperature, token limit, scheduler, retry,
redaction, and four-image request shape remain unchanged.

The prompt contains no evaluation query and introduces no special rule for
`sexy`.

### Schema addition

The provider object remains strict and adds `accessories` to `required`:

```json
{
  "accessories": {
    "$ref": "#/$defs/bilingualOptional"
  }
}
```

`accessories.en` and `accessories.ru` are strings with a maximum length of 240
characters. Empty strings mean no accessory is visibly established. The object
itself is always present so the model and parser cannot skip the inspection
step.

The internal envelope uses:

```json
{
  "schemaVersion": 2
}
```

All other v1 fields and their limits remain unchanged.

### Canonical caption text

Insert the new fields after clothing and before style:

```text
subject_en
subject_ru
appearance_en
appearance_ru
clothing_en
clothing_ru
accessories_en
accessories_ru
style_en
style_ru
mood_en
mood_ru
colors_en
colors_ru
search_terms_en
search_terms_ru
```

Normalization remains Unicode NFKC, collapsed whitespace, trimming, enforced
limits, and stable case-insensitive array deduplication.

The existing length-prefixed SHA-256 construction automatically makes v1 and
v2 caption/vector state stale across prompt, schema, canonical text, revision,
or source-image changes.

## Caption canaries

Before full v2 backfill, generate captions for a frozen attribute canary set:

| Pet | Visible attributes that must survive canonicalization |
|---|---|
| `fischl-detailed` | blonde hair, dark eye/face covering, purple-black outfit |
| `2b-2` | silver hair, dark eye/face covering, black outfit, sword |
| `master-of-terra` | golden armor, red cloak, flaming sword |
| `vi` | magenta hair, oversized gauntlets |

These canaries test generic attribute completeness, not final search ranking.
Each expected concept has a frozen bilingual `expectedAnyTerms` list. Matching
uses deterministic NFKC normalization and case-insensitive token or substring
checks across the English and Russian canonical fields. It does not call a
model judge or require one exact provider phrase.

If any canary misses a required visible attribute:

1. stop before full backfill;
2. keep visual mode `off` or `shadow`;
3. inspect the four source frames and sanitized field-presence diagnostics;
4. revise the prompt/schema under a new caption revision.

Do not silently edit the v2 contract after generating production rows.

## Ranking and calibration

Weighted RRF remains unchanged:

```text
lexical weight = 1.0
text weight = 1.0
visual weight = calibrated from 0.25, 0.50, 0.75, 1.00
k = 60
```

Exact slug and display-name precedence, independent score thresholds,
newest-first tie-breaking, approved-status checks, explicit user filters, and
all lexical/text fallbacks remain unchanged.

### Calibration acceptance

A v2 profile is eligible only if calibration satisfies every condition:

- exact-name MRR@5 equals `1.0`;
- negative visual-only safety passes;
- combined overall nDCG@5 is not below text-hybrid;
- visual-subset nDCG@5 lift is at least `15%`;
- at least one frozen relevant result appears in combined `sexy` top five.

Among eligible profiles, retain the existing deterministic choice:

1. highest visual-subset combined nDCG@5;
2. lower visual weight;
3. higher visual threshold.

If no profile passes, calibration fails and no v2 profile is committed.

## Evaluation redesign

### V1 fixtures

Preserve every existing fixture and label unchanged, but classify both previous
splits as:

```text
diagnostic-v1
```

They may explain regressions and support local tests, but they cannot choose or
approve the v2 profile.

### V2 suites

Create three distinct frozen suites:

1. `text-regression-v2`
   - at least 12 positive queries;
   - exact name/slug, multi-token, typo, semantic style, and Russian coverage;
   - at least 3 negative queries.
2. `visual-calibration-v2`
   - at least 12 positive visual-description queries;
   - appearance, clothing, accessory, color, mood, subject, and style coverage;
   - at least 3 negative queries and exact-match controls.
3. `visual-holdout-v2`
   - at least 8 positive visual-description queries;
   - at least 2 exact-match controls;
   - at least 3 negative queries;
   - no query duplicated from calibration.

The text-hybrid `20%` lift gate is measured on `text-regression-v2`, not on the
small visual holdout. The visual calibration and holdout independently measure
combined non-regression and `15%` incremental visual lift.

### Blinded pooled labels

For subjective and appearance queries:

1. Freeze query text and suite membership before calibration.
2. Build a candidate pool from the union of lexical, text, v1 visual, and raw
   v2 visual candidates, plus a deterministic catalog sample.
3. Do not expose system identity, rank, cosine score, threshold, or weight.
4. Present candidates in a stable pseudorandom order with only public pet
   identity and visual frames.
5. Record `relevant`, `irrelevant`, or `uncertain`.
6. Before metric calculation, condense each ranking to judged candidates;
   exclude `uncertain` and unjudged candidates rather than treating them as
   irrelevant.
7. Freeze the query, candidate-pool hash, labels, reviewer, and timestamp before
   running calibration.

This pooling makes subjective relevant sets materially more complete without
letting a reviewer optimize labels for one ranker.

### Holdout integrity

The v2 holdout is executed exactly once after:

- v2 canaries pass;
- full v2 backfill is fresh;
- blinded labels are frozen;
- calibration selects a profile;
- the profile is committed and the full verification chain passes.

Holdout rankings, scores, or metrics must not be inspected before that run. A
failed v2 holdout remains failed; it is reclassified as diagnostic and any
subsequent attempt requires a newly labeled v3 holdout.

## Search modes and failure behavior

No mode semantics change:

- production remains on its current image;
- the v2 candidate begins with visual `off`;
- v2 backfill and canaries may run while visual is `off`;
- `shadow` computes visual diagnostics without changing public order;
- `hybrid` is unavailable until a profile is committed;
- provider or text-vector failure returns lexical HTTP `200`;
- visual vector/caption failure returns text-hybrid HTTP `200`.

Captions, hashes, prompts, provider payloads, scores, and fixture labels remain
absent from public HTML, JSON, TOON, MCP, and WebMCP DTOs.

## Verification

### Fail-before tests

- v1 parsing still accepts the v1 envelope under the v1 revision.
- v2 parsing rejects a missing `accessories` object.
- v2 parsing accepts empty bilingual accessory strings.
- canonical v2 text places accessories in the frozen field order.
- caption and visual source hashes change from v1 to v2.
- provider requests still contain exactly four images and no catalog metadata.
- calibration rejects a profile with `14.99%` visual-subset lift.
- calibration accepts `15%` only when every other safety gate passes.
- fixture validation rejects duplicated calibration/holdout queries.
- fixture validation rejects a v2 split below its minimum category counts.
- public contract tests contain no caption, accessory, provenance, or score.

### Runtime checks

- run each attribute canary and inspect sanitized presence booleans only;
- apply a one-pet v2 caption/vector canary and verify source-hash association;
- complete the paced resumable v2 backfill;
- prove 137 approved pets have fresh v2 caption/vector pairs;
- verify v1 rows remain isolated and usable by the v1 rollback image;
- run text-regression and visual calibration;
- commit the passing v2 profile;
- execute the new holdout once;
- present any changed combined `sexy` top five for explicit review.

Run:

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

## Rollout and rollback

1. Commit this remediation design and its implementation plan.
2. Implement v2 through fail-before tests and separate logical commits.
3. Build an exact-SHA app image with visual `off`.
4. Run the four attribute canaries.
5. Backfill v2 captions and vectors without deleting v1.
6. Enable v2 shadow and collect aggregate latency/fallback diagnostics.
7. Freeze blinded labels, calibrate, and commit a passing profile.
8. Build a new exact-SHA candidate.
9. Execute the v2 holdout once.
10. Stop on any failed gate.
11. Obtain another human review if the combined `sexy` top five changed.
12. Only then verify visual `hybrid` on the isolated candidate and perform the
    existing app-only production cutover.

The first rollback remains:

```text
PET_SEARCH_VISUAL_MODE=off
```

Image rollback restores the preserved production app image and environment.
V1 and v2 caption/vector rows remain additive. No nginx, YDB topology,
authentication, volume, or destructive schema rollback is permitted.

## Acceptance criteria

The remediation is complete only when:

- v2 captions explicitly preserve all frozen canary attributes;
- all 137 approved pets have fresh v2 caption/vector pairs;
- no calibration profile below `15%` visual lift can be committed;
- the text-regression suite retains at least `20%` text-hybrid lift;
- the new untouched visual holdout achieves at least `15%` lift with no overall
  regression;
- exact MRR, negative safety, fallback HTTP behavior, latency, and public
  privacy gates pass;
- any changed `sexy` top five receives explicit human review;
- production serves the passing combined order;
- production identity, local-YDB health, and unchanged nginx/topology are read
  back after cutover.
