import { normalizeGalleryFilters } from "@/lib/pets/gallery-filters";
import {
  fuseRankedPets,
  normalizeSearchQuery,
  rankPetsLexically,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";
import type {
  PetSearchVisualMode,
  PetVisualCalibrationProfile,
  PetVisualSearchFallbackReason,
} from "@/lib/pets/search-config";
import type { PetKind } from "@/lib/pets/types";

const DEFAULT_RESULT_LIMIT = 200;
const MAX_RESULT_LIMIT = 200;
export const DEFAULT_MIN_SEMANTIC_SCORE = 0.55;

export type PetSearchCatalogItem = {
  slug: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
  ownerName: string | null;
};

export type PetSearchInput = {
  q?: string;
  kind?: PetKind | "all";
  tags?: string[];
  author?: string;
  limit?: number;
};

export type PetSearchMode = "lexical" | "shadow" | "hybrid";
export type PetSearchResultMode = PetSearchMode | "lexical_fallback";
export type PetSearchFallbackReason =
  | "configuration_missing"
  | "invalid_request"
  | "invalid_response"
  | "overloaded"
  | "provider_error"
  | "rate_limited"
  | "secret_unavailable"
  | "semantic_calibration_missing"
  | "semantic_error"
  | "timeout"
  | "unsupported_model_revision"
  | "vector_search_error";

export class PetSearchFallbackError extends Error {
  constructor(public readonly reason: PetSearchFallbackReason) {
    super("Semantic pet search is unavailable.");
    this.name = "PetSearchFallbackError";
  }
}

export type PetSearchResult<T extends PetSearchCatalogItem> = {
  pets: T[];
  total: number;
  mode: PetSearchResultMode;
  fallbackReason: PetSearchFallbackReason | null;
  visualMode: PetSearchVisualMode;
  visualFallbackReason: PetVisualSearchFallbackReason | null;
  visualCandidateCount: number;
  durationMs: number;
};

export type PetSemanticSearchResult = {
  text: SemanticPetMatch[];
  visual: SemanticPetMatch[];
  visualFallbackReason: PetVisualSearchFallbackReason | null;
};

type PetSearchDependencies<T extends PetSearchCatalogItem> = {
  listApprovedPets: () => Promise<T[]>;
  semanticSearch: (
    query: string,
    candidates: readonly T[],
  ) => Promise<PetSemanticSearchResult>;
  mode: PetSearchMode;
  minSemanticScore?: number;
  visualMode?: PetSearchVisualMode;
  visualProfile?: PetVisualCalibrationProfile | null;
  configuredVisualFallbackReason?: PetVisualSearchFallbackReason | null;
  now?: () => number;
};

export function createPetSearchService<T extends PetSearchCatalogItem>(
  dependencies: PetSearchDependencies<T>,
): (input?: PetSearchInput) => Promise<PetSearchResult<T>> {
  return async (input = {}) => {
    const now = dependencies.now ?? Date.now;
    const startedAt = now();
    const visualMode = dependencies.visualMode ?? "off";
    const filters = normalizeGalleryFilters(input);
    const author = normalizeSearchQuery(input.author).text;
    const limit = normalizeLimit(input.limit);
    const catalog = await dependencies.listApprovedPets();
    const candidates = catalog.filter((pet) =>
      matchesHardFilters(pet, filters.kind, filters.tags, author),
    );

    if (!filters.query) {
      return result(candidates, candidates.length, "lexical", null);
    }

    const lexical = rankPetsLexically(candidates, filters.query);
    const lexicalPets = lexical.map((match) => match.pet);
    if (
      dependencies.mode === "lexical" ||
      normalizeSearchQuery(filters.query).text.length < 3
    ) {
      return result(lexicalPets, lexicalPets.length, "lexical", null);
    }

    try {
      const semantic = await dependencies.semanticSearch(
        filters.query,
        candidates,
      );
      const fused = fuseRankedPets({
        pets: candidates,
        lexical,
        semanticRanks: [
          {
            matches: semantic.text,
            minScore:
              dependencies.minSemanticScore ?? DEFAULT_MIN_SEMANTIC_SCORE,
            weight: 1,
          },
          ...(dependencies.mode === "hybrid" &&
          visualMode === "hybrid" &&
          dependencies.visualProfile
            ? [
                {
                  matches: semantic.visual,
                  minScore:
                    dependencies.visualProfile.minSemanticScore,
                  weight: dependencies.visualProfile.weight,
                },
              ]
            : []),
        ],
      });
      const visualFallbackReason =
        visualMode === "off"
          ? null
          : (semantic.visualFallbackReason ??
            dependencies.configuredVisualFallbackReason ??
            null);
      const visualCandidateCount =
        visualMode === "off" ? 0 : semantic.visual.length;

      if (dependencies.mode === "shadow") {
        return result(
          lexicalPets,
          lexicalPets.length,
          "shadow",
          null,
          visualFallbackReason,
          visualCandidateCount,
        );
      }

      return result(
        fused,
        fused.length,
        "hybrid",
        null,
        visualFallbackReason,
        visualCandidateCount,
      );
    } catch (error) {
      return result(
        lexicalPets,
        lexicalPets.length,
        "lexical_fallback",
        error instanceof PetSearchFallbackError
          ? error.reason
          : "semantic_error",
      );
    }

    function result(
      pets: T[],
      total: number,
      mode: PetSearchResultMode,
      fallbackReason: PetSearchFallbackReason | null,
      visualFallbackReason: PetVisualSearchFallbackReason | null = null,
      visualCandidateCount = 0,
    ): PetSearchResult<T> {
      return {
        pets: pets.slice(0, limit),
        total,
        mode,
        fallbackReason,
        visualMode,
        visualFallbackReason,
        visualCandidateCount,
        durationMs: Math.max(0, now() - startedAt),
      };
    }
  };
}

function matchesHardFilters(
  pet: PetSearchCatalogItem,
  kind: PetKind | "all",
  tags: readonly string[],
  author: string,
): boolean {
  if (kind !== "all" && pet.kind !== kind) return false;

  const normalizedTags = pet.tags.map((tag) =>
    tag.normalize("NFKC").toLowerCase().trim(),
  );
  if (tags.length > 0 && !tags.every((tag) => normalizedTags.includes(tag))) {
    return false;
  }

  if (
    author &&
    !normalizeSearchQuery(pet.ownerName).text.includes(author)
  ) {
    return false;
  }

  return true;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RESULT_LIMIT;
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.trunc(value ?? 0)));
}
