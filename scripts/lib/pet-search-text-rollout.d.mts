export function parseTextRolloutEvidence(environment: Record<string, string | undefined>): {
  providerFallbackHttpStatuses: number[];
  reviewedBy: string;
};
