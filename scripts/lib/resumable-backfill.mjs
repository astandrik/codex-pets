import { parseArgs } from "node:util";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function parseResumableBackfillArgs(
  argv,
  { maxConcurrency = 10 } = {},
) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean" },
        apply: { type: "boolean" },
        slug: { type: "string" },
        force: { type: "boolean" },
        "continue-on-error": { type: "boolean" },
        concurrency: { type: "string" },
      },
    }));
  } catch (error) {
    throw new Error(`Unknown argument or invalid value: ${error.message}`, {
      cause: error,
    });
  }

  if (Boolean(values["dry-run"]) === Boolean(values.apply)) {
    throw new Error("Pass exactly one of --dry-run or --apply.");
  }
  const mode = values.apply ? "apply" : "dry-run";
  const slug = values.slug ?? null;
  const force = values.force ?? false;
  const continueOnError = values["continue-on-error"] ?? false;
  const concurrency = parseConcurrency(values.concurrency, maxConcurrency);

  if (values.slug !== undefined && !SAFE_SLUG.test(values.slug)) {
    throw new Error("--slug must be a valid public pet slug.");
  }
  if (force && mode !== "apply") {
    throw new Error("--force requires --apply.");
  }
  if (continueOnError && slug) {
    throw new Error("--continue-on-error cannot be combined with --slug.");
  }
  if (slug && concurrency !== 1) {
    throw new Error("--concurrency cannot be combined with --slug.");
  }
  if (mode === "apply" && concurrency > 1 && !continueOnError) {
    throw new Error("Parallel --apply requires --continue-on-error.");
  }
  return {
    mode,
    slug,
    force,
    continueOnError,
    concurrency,
  };
}

export async function runResumableBackfill({
  items,
  options,
  processItem,
  itemId = (item) => item.slug,
  failureDetails = () => ({}),
  log = console.log,
}) {
  const summary = {
    scanned: items.length,
    unchanged: 0,
    planned: 0,
    updated: 0,
    failed: 0,
    failedSlugs: [],
  };
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency ?? 1, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      const slug = itemId(item);
      try {
        const outcome = await processItem(item);
        if (!["unchanged", "planned", "updated"].includes(outcome)) {
          throw new Error("invalid_backfill_outcome");
        }
        summary[outcome] += 1;
        if (outcome === "planned") log({ action: "would-update", slug });
        if (outcome === "updated") log({ action: "updated", slug });
      } catch (error) {
        summary.failed += 1;
        summary.failedSlugs.push(slug);
        log({
          action: "failed",
          slug,
          reason: sanitizedReason(error),
          ...failureDetails(error),
        });
        if (!(options.continueOnError ?? false)) throw error;
      }
    }
  }));

  summary.failedSlugs.sort();
  log({ action: "summary", ...summary });
  return summary;
}

export function selectApprovedItems(items, slug) {
  const approved = items.filter(
    (item) => !item.status || item.status === "approved",
  );
  const selected = slug
    ? approved.filter((item) => item.slug === slug)
    : approved;
  if (slug && selected.length === 0) {
    throw new Error(`Approved pet slug not found: ${slug}`);
  }
  return selected;
}

function parseConcurrency(input, maximum) {
  if (input === undefined) return 1;
  if (!/^\d+$/.test(input)) {
    throw new Error(`--concurrency must be an integer from 1 to ${maximum}.`);
  }
  const value = Number(input);
  if (value < 1 || value > maximum) {
    throw new Error(`--concurrency must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function sanitizedReason(error) {
  if (typeof error?.reason === "string") return error.reason;
  if (typeof error?.message === "string" && /^[a-z_]+$/.test(error.message)) {
    return error.message;
  }
  return "processing_failed";
}
