export function parseTextRolloutEvidence(environment) {
  const statusValue =
    environment.PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES?.trim() ?? "";
  const statusParts = statusValue.split(",").map((value) => value.trim());
  const providerFallbackHttpStatuses = statusParts.map(Number);
  if (
    statusParts.length !== 3 ||
    statusParts.some((value) => !/^\d{3}$/.test(value)) ||
    providerFallbackHttpStatuses.some((status) => status < 100 || status > 599)
  ) {
    throw new Error(
      "PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES must contain exactly three measured HTTP statuses.",
    );
  }

  const reviewedBy =
    environment.PET_SEARCH_TEXT_HOLDOUT_REVIEWED_BY?.trim() ?? "";
  if (!reviewedBy) {
    throw new Error(
      "PET_SEARCH_TEXT_HOLDOUT_REVIEWED_BY must identify the human reviewer.",
    );
  }

  return { providerFallbackHttpStatuses, reviewedBy };
}
