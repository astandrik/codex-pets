export type RelatedPetsV24VerificationService = {
  rebuild: (input: {
    mode: "dry-run";
    includeVisual: true;
  }) => Promise<{
    coverage: Record<string, number>;
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
  }>;
  getState: () => Promise<{
    status: string;
    activeGenerationId: string | null;
    rankingRevision: string;
  } | null>;
  listSnapshots: (generationId: string) => Promise<Array<{
    sourceSlug: string;
    rankingRevision: string;
    relatedSlugs: string[];
  }>>;
  listCandidates: () => Promise<Array<{
    slug: string;
    displayName: string;
    description: string;
    kind: string;
    tags: string[];
    createdAt: string;
    approvedAt: string | null;
  }>>;
  rankingRevision: string;
  dispose?: () => Promise<void>;
};

export function runRelatedPetsV24Verification(input?: {
  argv?: string[];
  loadService?: () => Promise<RelatedPetsV24VerificationService>;
  write?: (line: string) => void;
}): Promise<number>;
