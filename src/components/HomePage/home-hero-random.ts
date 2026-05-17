export function pickRandomHeroPetIndex(
  length: number,
  currentIndex: number | null = null,
  random: () => number = Math.random,
): number | null {
  if (!Number.isInteger(length) || length <= 0) {
    return null;
  }

  if (length === 1) {
    return 0;
  }

  const current =
    currentIndex !== null &&
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < length
      ? currentIndex
      : null;

  if (current === null) {
    return randomInt(length, random);
  }

  return (current + randomInt(length - 1, random) + 1) % length;
}

function randomInt(limit: number, random: () => number): number {
  const value = random();
  const normalized = Number.isFinite(value) ? value : 0;
  return Math.min(Math.max(Math.floor(normalized * limit), 0), limit - 1);
}
