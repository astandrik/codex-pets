const compactMetricFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "compact",
});

export function formatMetricCount(value: number): string {
  return compactMetricFormatter.format(Math.max(0, value));
}

export function metricLabel(
  value: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return value === 1 ? singular : plural;
}
