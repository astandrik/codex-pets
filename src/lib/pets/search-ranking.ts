const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_TOKENS = 12;
const RRF_K = 60;

export type SearchablePet = {
  slug: string;
  displayName: string;
  description: string;
  tags: string[];
};

export type NormalizedSearchQuery = {
  text: string;
  tokens: string[];
};

export type LexicalPetMatch<T extends SearchablePet> = {
  pet: T;
  score: number;
  exactIdentifier: boolean;
};

export type SemanticPetMatch = {
  slug: string;
  score: number;
};

export function normalizeSearchQuery(value: unknown): NormalizedSearchQuery {
  if (typeof value !== "string") return { text: "", tokens: [] };

  let text = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  const tokenMatches = Array.from(text.matchAll(/[\p{L}\p{N}]+/gu));
  if (tokenMatches.length > MAX_QUERY_TOKENS) {
    const lastToken = tokenMatches[MAX_QUERY_TOKENS - 1];
    const end = (lastToken?.index ?? 0) + (lastToken?.[0].length ?? 0);
    text = text.slice(0, end).trim();
  }
  const tokens = tokenMatches
    .slice(0, MAX_QUERY_TOKENS)
    .map((match) => match[0]);

  return { text, tokens };
}

export function rankPetsLexically<T extends SearchablePet>(
  pets: readonly T[],
  queryValue: unknown,
): LexicalPetMatch<T>[] {
  const query = normalizeSearchQuery(queryValue);
  if (!query.text || query.tokens.length === 0) return [];

  return pets
    .map((pet, index) => ({
      match: lexicalMatch(pet, query),
      index,
    }))
    .filter(
      (item): item is { match: LexicalPetMatch<T>; index: number } =>
        item.match !== null,
    )
    .sort(
      (left, right) =>
        right.match.score - left.match.score || left.index - right.index,
    )
    .map((item) => item.match);
}

export function fuseRankedPets<T extends SearchablePet>(input: {
  pets: readonly T[];
  lexical: readonly LexicalPetMatch<T>[];
  semantic: readonly SemanticPetMatch[];
  minSemanticScore: number;
}): T[] {
  const petBySlug = new Map(input.pets.map((pet) => [pet.slug, pet]));
  const originalIndex = new Map(
    input.pets.map((pet, index) => [pet.slug, index]),
  );
  const ranks = new Map<
    string,
    { score: number; exactIdentifier: boolean }
  >();

  input.lexical.forEach((match, index) => {
    ranks.set(match.pet.slug, {
      score: reciprocalRank(index),
      exactIdentifier: match.exactIdentifier,
    });
  });

  input.semantic
    .filter((match) => match.score >= input.minSemanticScore)
    .sort((left, right) => right.score - left.score)
    .forEach((match, index) => {
      if (!petBySlug.has(match.slug)) return;
      const current = ranks.get(match.slug) ?? {
        score: 0,
        exactIdentifier: false,
      };
      ranks.set(match.slug, {
        ...current,
        score: current.score + reciprocalRank(index),
      });
    });

  return Array.from(ranks, ([slug, rank]) => ({
    pet: petBySlug.get(slug),
    rank,
    originalIndex: originalIndex.get(slug) ?? Number.MAX_SAFE_INTEGER,
  }))
    .filter((item): item is { pet: T; rank: { score: number; exactIdentifier: boolean }; originalIndex: number } => Boolean(item.pet))
    .sort(
      (left, right) =>
        Number(right.rank.exactIdentifier) -
          Number(left.rank.exactIdentifier) ||
        right.rank.score - left.rank.score ||
        left.originalIndex - right.originalIndex,
    )
    .map((item) => item.pet);
}

function lexicalMatch<T extends SearchablePet>(
  pet: T,
  query: NormalizedSearchQuery,
): LexicalPetMatch<T> | null {
  const slug = normalizeIdentifier(pet.slug);
  const name = normalizeIdentifier(pet.displayName);
  const nameTokens = tokenize(name);
  const tags = pet.tags.map(normalizeIdentifier);
  const tagTokens = tags.flatMap(tokenize);
  const typoCandidates = [...nameTokens, ...tagTokens];
  const description = normalizeIdentifier(pet.description);
  const descriptionTokens = tokenize(description);
  const queryIdentifier = normalizeIdentifier(query.text);
  const exactIdentifier = queryIdentifier === slug || queryIdentifier === name;

  let score = 0;
  if (exactIdentifier) {
    score = 1_000;
  } else if (name.startsWith(queryIdentifier)) {
    score = 800;
  } else if (containsEveryToken(nameTokens, query.tokens)) {
    score = 700;
  } else if (tags.includes(queryIdentifier)) {
    score = 600;
  } else if (
    description.includes(queryIdentifier) ||
    containsEveryToken(descriptionTokens, query.tokens)
  ) {
    score = 500;
  } else if (
    query.tokens.some((queryToken) => !typoCandidates.includes(queryToken)) &&
    query.tokens.every((queryToken) =>
      typoCandidates.some((candidate) =>
        isBoundedTypo(queryToken, candidate),
      ),
    )
  ) {
    score = 300;
  }

  return score > 0 ? { pet, score, exactIdentifier } : null;
}

function normalizeIdentifier(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function containsEveryToken(
  candidates: readonly string[],
  queryTokens: readonly string[],
): boolean {
  return queryTokens.every((queryToken) => candidates.includes(queryToken));
}

function isBoundedTypo(queryToken: string, candidate: string): boolean {
  const maxDistance = queryToken.length >= 8 ? 2 : queryToken.length >= 4 ? 1 : 0;
  if (maxDistance === 0 || Math.abs(queryToken.length - candidate.length) > maxDistance) {
    return false;
  }
  return editDistanceAtMost(queryToken, candidate, maxDistance);
}

function editDistanceAtMost(
  left: string,
  right: string,
  maxDistance: number,
): boolean {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1] +
        Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      const value = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        substitution,
      );
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) return false;
    previous = current;
  }

  return (previous[right.length] ?? maxDistance + 1) <= maxDistance;
}

function reciprocalRank(index: number): number {
  return 1 / (RRF_K + index + 1);
}
