export type RelatedPetsRebuildCliMode =
  | "dry-run"
  | "apply"
  | "recover-previous"
  | "help";

export const RELATED_PETS_REBUILD_HELP: string;

export function parseRelatedPetsRebuildArgs(
  argv: string[],
): { mode: RelatedPetsRebuildCliMode };

type RelatedPetsCliService = {
  rebuild: (input: {
    mode: "dry-run" | "apply";
    includeVisual: boolean;
  }) => Promise<{
    operation: "dry-run" | "apply";
    status: "dry-run" | "ready" | "superseded";
    generationId: string | null;
    rankingRevision: string;
    coverage: {
      approvedPetCount: number;
      snapshotCount: number;
      textVectorCount: number;
      visualVectorCount: number;
    };
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    durationMs: number;
  }>;
  recoverPrevious: () => Promise<{
    status: "recovered" | "unavailable";
    generationId: string | null;
    rankingRevision: string;
    durationMs: number;
  }>;
  dispose?: () => Promise<void>;
};

export function runRelatedPetsRebuildCli(input?: {
  argv?: string[];
  loadService?: () => Promise<RelatedPetsCliService>;
  write?: (line: string) => void;
}): Promise<number>;
