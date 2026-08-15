export type ResumableBackfillOptions = {
  mode: "dry-run" | "apply";
  slug: string | null;
  force: boolean;
  continueOnError: boolean;
  concurrency: number;
  reuseProposalsFrom?: string | null;
};

export type BackfillOutcome = "unchanged" | "planned" | "updated";
export type ResumableBackfillSummary = {
  scanned: number;
  unchanged: number;
  planned: number;
  updated: number;
  failed: number;
  failedSlugs: string[];
};

export function parseResumableBackfillArgs(
  argv: string[],
  options?: { allowReuseProposals?: boolean; maxConcurrency?: number },
): ResumableBackfillOptions;
export function selectApprovedItems<
  T extends { slug: string; status?: string },
>(items: T[], slug: string | null): T[];
export function runResumableBackfill<T>(input: {
  items: T[];
  options: ResumableBackfillOptions;
  processItem: (item: T) => Promise<BackfillOutcome>;
  itemId?: (item: T) => string;
  failureDetails?: (error: unknown) => Record<string, unknown>;
  log?: (entry: unknown) => void;
}): Promise<ResumableBackfillSummary>;
