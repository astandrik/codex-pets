export type PetVisionCanaryExpectation = {
  readonly id: string;
  readonly expectedAnyTerms: readonly string[];
};

export type PetVisionCanary = {
  readonly slug: string;
  readonly expectations: readonly PetVisionCanaryExpectation[];
};

export type PetVisionCanaryResult = {
  slug: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean }>;
};

const DARK_EYE_COVERING_TERMS = [
  "dark eye covering",
  "black eye covering",
  "eye covering",
  "one eye covered",
  "covered eye",
  "eye patch",
  "eyepatch",
  "blindfold",
  "повязка на глаз",
  "чёрная повязка",
  "черная повязка",
  "закрытый глаз",
  "один глаз закрыт",
] as const;

const DARK_OUTFIT_TERMS = [
  "black outfit",
  "dark outfit",
  "black clothing",
  "dark clothing",
  "black dress",
  "чёрный наряд",
  "черный наряд",
  "тёмный наряд",
  "темный наряд",
  "чёрная одежда",
  "черная одежда",
  "чёрное платье",
  "черное платье",
] as const;

export const PET_VISION_V2_CANARIES = [
  {
    slug: "fischl-detailed",
    expectations: [
      {
        id: "blonde_hair",
        expectedAnyTerms: [
          "blonde hair",
          "blond hair",
          "fair hair",
          "белокурые волосы",
          "светлые волосы",
          "волосы блонд",
        ],
      },
      {
        id: "dark_eye_covering",
        expectedAnyTerms: DARK_EYE_COVERING_TERMS,
      },
      {
        id: "purple_outfit",
        expectedAnyTerms: [
          "purple outfit",
          "violet outfit",
          "purple clothing",
          "violet clothing",
          "purple dress",
          "фиолетовый наряд",
          "фиолетовая одежда",
          "фиолетовое платье",
          "пурпурный наряд",
        ],
      },
      {
        id: "dark_outfit",
        expectedAnyTerms: DARK_OUTFIT_TERMS,
      },
    ],
  },
  {
    slug: "2b-2",
    expectations: [
      {
        id: "silver_hair",
        expectedAnyTerms: [
          "silver hair",
          "silver white hair",
          "white silver hair",
          "серебристые волосы",
          "серебряные волосы",
          "серебристо белые волосы",
        ],
      },
      {
        id: "dark_eye_covering",
        expectedAnyTerms: DARK_EYE_COVERING_TERMS,
      },
      {
        id: "dark_outfit",
        expectedAnyTerms: DARK_OUTFIT_TERMS,
      },
      {
        id: "sword",
        expectedAnyTerms: [
          "sword",
          "blade",
          "katana",
          "меч",
          "клинок",
          "катана",
        ],
      },
    ],
  },
  {
    slug: "master-of-terra",
    expectations: [
      {
        id: "golden_armor",
        expectedAnyTerms: [
          "golden armor",
          "gold armor",
          "ornate golden armour",
          "золотая броня",
          "золотые доспехи",
        ],
      },
      {
        id: "red_cloak",
        expectedAnyTerms: [
          "red cloak",
          "red cape",
          "red mantle",
          "красный плащ",
          "красная мантия",
          "красная накидка",
        ],
      },
      {
        id: "flaming_sword",
        expectedAnyTerms: [
          "flaming sword",
          "burning sword",
          "fiery sword",
          "sword in flames",
          "огненный меч",
          "пылающий меч",
          "горящий меч",
          "меч в огне",
        ],
      },
    ],
  },
  {
    slug: "vi",
    expectations: [
      {
        id: "magenta_hair",
        expectedAnyTerms: [
          "magenta hair",
          "fuchsia hair",
          "pink hair",
          "пурпурные волосы",
          "малиновые волосы",
          "розовые волосы",
        ],
      },
      {
        id: "oversized_gauntlets",
        expectedAnyTerms: [
          "oversized gauntlets",
          "massive gauntlets",
          "huge gauntlets",
          "large gauntlets",
          "oversized mechanical gauntlets",
          "массивные перчатки",
          "огромные перчатки",
          "большие рукавицы",
          "массивные рукавицы",
        ],
      },
    ],
  },
] as const satisfies readonly PetVisionCanary[];

export function evaluatePetVisionCanary(
  slug: string,
  captionText: string,
): PetVisionCanaryResult | null {
  const canary = PET_VISION_V2_CANARIES.find(
    (candidate) => candidate.slug === slug,
  );
  if (!canary) return null;

  const normalizedCaption = normalizeCanaryText(captionText);
  const checks = canary.expectations.map((expectation) => ({
    id: expectation.id,
    passed: expectation.expectedAnyTerms.some((term) =>
      containsTerm(normalizedCaption, normalizeCanaryText(term)),
    ),
  }));
  return {
    slug,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function containsTerm(caption: string, term: string): boolean {
  if (!term) return false;
  if (term.includes(" ")) return caption.includes(term);
  return caption.split(" ").includes(term);
}

function normalizeCanaryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
