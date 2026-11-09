# Reviewing automatic character names

Use [the naming and description guidelines](pet-naming-guidelines.md) for the
editorial rules and five reviewed examples. Metadata policy 4 applies those
rules to new jobs: usually 2–4-word character names and concrete descriptions.

Deploy readers that support policies 1, 2, 3 and 4 in both web and worker before
allowing new admissions to write policy 4. Existing jobs retain their saved
policy and request hash. Once policy 4 jobs exist, rollback requires a compatible
reader; do not restart their metadata requests using an older policy.

After deployment, follow the next 20 ordinary generations admitted with
`cardMetadata.policy === 4` and `nameSource === "automatic"`. Record one row per
generation ID in creation order (break ties by ID). Use read-only observations
before expiry. Record failures, missing evidence and manual edits in their
original rows, so the sample does not silently become 20 selected successes.
Keep private generation links, prompts and images out of the shared report.

For each completed, unedited result:

1. Compare its saved name and description with the four frames the metadata
   request used (idle, running right, waving, review). Check that the name fits
   the character and the description identifies it through visible facts.
   Record unsupported details, invented biography and repeated wording.
2. Compare similar pets side by side. Record repetitive clothing-plus-species
   labels, arbitrary word pairs, or repeated name-and-epithet formulas. A creative
   association in a name does not establish a factual claim in its description.
3. Show the exact name in My generations at 360 and 390 CSS pixels. Record the
   actual number of rendered title lines at each width and any overflow. Keep
   the 320-pixel, single-column view as a control.

Report reviewed results out of 20, names fitting in two lines at each width,
repetitive naming patterns, ambiguous descriptions and unsupported traits with
examples. Two to four words is guidance, not a hard validation rule. Preserve
explicit user names and full confirmed identities. The existing 80-character
name limit and 320-character description limit still apply.

Use naturally completed results; no test generation or metadata replay is
needed. Contract tests verify request construction, persisted policy and safe
recovery. They do not prove the quality of future model responses.
