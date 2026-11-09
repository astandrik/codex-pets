# Reviewing compact automatic pet names

Deploy readers that support policies 1, 2 and 3 in both web and worker before
allowing new admissions to write policy 3. Once those jobs exist, rollback
requires a reader that can still process them.

After deployment, follow the next 20 ordinary
generations admitted with `cardMetadata.policy === 3` and `nameSource === "automatic"`.
Record one row per generation ID in creation order (break ties by ID). Use
read-only observations before expiry. Record failures, missing evidence and
manual edits in their original rows, so the sample does not silently become
20 selected successes. Keep private generation links, prompts and images out
of the shared report.

For each completed, unedited result:

1. Compare its saved name and description with the four frames the metadata
   request used (idle, running right, waving, review). Record which visible
   trait identifies the pet and any unsupported or repeated detail.
2. Compare similar pets side by side. Does the name distinguish the character?
   If a longer name preserves an identified character or distinguishes a real
   variant, note that reason.
3. Show the exact name in My generations at 360 and 390 CSS pixels. Record the
   actual number of rendered title lines at each width and any overflow. Keep
   the 320-pixel, single-column view as a control.

Report the number reviewed out of 20, the number fitting in two lines at each
width, and the counts of ambiguous names and unsupported traits with examples.
Two to four words is guidance for automatic names. The existing 80-character
limit and the user's supplied name still apply. Use naturally completed results
for this review; no generation or metadata replay is needed.
