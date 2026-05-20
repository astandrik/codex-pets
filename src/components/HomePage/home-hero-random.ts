type PickRandomHeroPetIndexOptions = {
  excludedIndexes?: readonly number[];
  random?: () => number;
};

export function pickRandomHeroPetIndex(
  length: number,
  currentIndex: number | null = null,
  options: PickRandomHeroPetIndexOptions | (() => number) = {},
): number | null {
  if (!Number.isInteger(length) || length <= 0) {
    return null;
  }

  if (length === 1) {
    return 0;
  }

  const { excludedIndexes, random } = normalizeOptions(options);
  const current =
    currentIndex !== null &&
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < length
      ? currentIndex
      : null;

  const candidates = collectCandidateIndexes(length, current, excludedIndexes);
  if (candidates.length > 0) {
    return candidates[randomInt(candidates.length, random)];
  }

  const fallbackCandidates = collectCandidateIndexes(length, current, []);
  return fallbackCandidates[randomInt(fallbackCandidates.length, random)] ?? null;
}

function normalizeOptions(
  options: PickRandomHeroPetIndexOptions | (() => number),
): Required<PickRandomHeroPetIndexOptions> {
  if (typeof options === "function") {
    return {
      excludedIndexes: [],
      random: options,
    };
  }

  return {
    excludedIndexes: options.excludedIndexes ?? [],
    random: options.random ?? Math.random,
  };
}

function collectCandidateIndexes(
  length: number,
  currentIndex: number | null,
  excludedIndexes: readonly number[],
): number[] {
  const excluded = new Set<number>();
  if (currentIndex !== null) {
    excluded.add(currentIndex);
  }

  for (const index of excludedIndexes) {
    if (Number.isInteger(index) && index >= 0 && index < length) {
      excluded.add(index);
    }
  }

  const candidates: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!excluded.has(index)) {
      candidates.push(index);
    }
  }

  return candidates;
}

function randomInt(limit: number, random: () => number): number {
  const value = random();
  const normalized = Number.isFinite(value) ? value : 0;
  return Math.min(Math.max(Math.floor(normalized * limit), 0), limit - 1);
}
