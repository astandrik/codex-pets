import type {
  PET_VISION_ATTRIBUTE_SLOTS_V3,
  PetVisionCaptionV3,
} from "@/lib/pets/search-vision-contract";

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

type PetVisionAttributeSlotV3 =
  (typeof PET_VISION_ATTRIBUTE_SLOTS_V3)[number];

export type PetVisionV3CanaryExpectation = {
  readonly id: string;
  readonly slot: PetVisionAttributeSlotV3;
  readonly expectedAnyTermsEn: readonly string[];
  readonly expectedAnyTermsRu: readonly string[];
};

export type PetVisionV3Canary = {
  readonly slug: string;
  readonly expectations: readonly PetVisionV3CanaryExpectation[];
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

const DARK_EYE_COVERING_TERMS_EN_V3 = [
  "dark eye covering",
  "black eye covering",
  "dark eye patch",
  "black eye patch",
  "dark eyepatch",
  "black eyepatch",
  "dark blindfold",
  "black blindfold",
] as const;

const DARK_EYE_COVERING_TERMS_RU_V3 = [
  "чёрная повязка на глаз",
  "черная повязка на глаз",
  "тёмная повязка на глаз",
  "темная повязка на глаз",
  "чёрная повязка",
  "черная повязка",
  "тёмная повязка",
  "темная повязка",
] as const;

const DARK_OUTFIT_TERMS_EN_V3 = [
  "black outfit",
  "dark outfit",
  "black clothing",
  "dark clothing",
  "black dress",
] as const;

const DARK_OUTFIT_TERMS_RU_V3 = [
  "чёрный наряд",
  "черный наряд",
  "тёмный наряд",
  "темный наряд",
  "чёрная одежда",
  "черная одежда",
  "чёрное платье",
  "черное платье",
] as const;

export const PET_VISION_V3_CANARIES = [
  {
    slug: "fischl-detailed",
    expectations: [
      {
        id: "blonde_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: ["blonde hair", "blond hair", "fair hair"],
        expectedAnyTermsRu: [
          "белокурые волосы",
          "светлые волосы",
          "волосы блонд",
        ],
      },
      {
        id: "dark_eye_covering",
        slot: "face_and_eye_coverings",
        expectedAnyTermsEn: DARK_EYE_COVERING_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_EYE_COVERING_TERMS_RU_V3,
      },
      {
        id: "purple_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: [
          "purple outfit",
          "violet outfit",
          "purple clothing",
          "violet clothing",
          "purple dress",
        ],
        expectedAnyTermsRu: [
          "фиолетовый наряд",
          "фиолетовая одежда",
          "фиолетовое платье",
          "пурпурный наряд",
        ],
      },
      {
        id: "dark_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: DARK_OUTFIT_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_OUTFIT_TERMS_RU_V3,
      },
    ],
  },
  {
    slug: "2b-2",
    expectations: [
      {
        id: "silver_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: [
          "silver hair",
          "silver white hair",
          "white silver hair",
        ],
        expectedAnyTermsRu: [
          "серебристые волосы",
          "серебряные волосы",
          "серебристо белые волосы",
        ],
      },
      {
        id: "dark_eye_covering",
        slot: "face_and_eye_coverings",
        expectedAnyTermsEn: DARK_EYE_COVERING_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_EYE_COVERING_TERMS_RU_V3,
      },
      {
        id: "dark_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: DARK_OUTFIT_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_OUTFIT_TERMS_RU_V3,
      },
      {
        id: "sword",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: ["sword", "blade", "katana"],
        expectedAnyTermsRu: ["меч", "клинок", "катана"],
      },
    ],
  },
  {
    slug: "master-of-terra",
    expectations: [
      {
        id: "golden_armor",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: [
          "golden armor",
          "gold armor",
          "ornate golden armour",
        ],
        expectedAnyTermsRu: ["золотая броня", "золотые доспехи"],
      },
      {
        id: "red_cloak",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: ["red cloak", "red cape", "red mantle"],
        expectedAnyTermsRu: [
          "красный плащ",
          "красная мантия",
          "красная накидка",
        ],
      },
      {
        id: "sword",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: ["sword", "blade"],
        expectedAnyTermsRu: ["меч", "клинок"],
      },
      {
        id: "flame_effect",
        slot: "visible_effects",
        expectedAnyTermsEn: ["fire", "flame", "flames", "burning", "fiery"],
        expectedAnyTermsRu: [
          "огонь",
          "пламя",
          "горящий",
          "пылающий",
          "огненный",
        ],
      },
    ],
  },
  {
    slug: "vi",
    expectations: [
      {
        id: "magenta_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: ["magenta hair", "fuchsia hair", "pink hair"],
        expectedAnyTermsRu: [
          "пурпурные волосы",
          "малиновые волосы",
          "розовые волосы",
        ],
      },
      {
        id: "oversized_gauntlets",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: [
          "oversized gauntlets",
          "massive gauntlets",
          "huge gauntlets",
          "large gauntlets",
          "oversized mechanical gauntlets",
        ],
        expectedAnyTermsRu: [
          "массивные перчатки",
          "огромные перчатки",
          "большие рукавицы",
          "массивные рукавицы",
        ],
      },
    ],
  },
] as const satisfies readonly PetVisionV3Canary[];

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

export function evaluatePetVisionV3Canary(
  slug: string,
  caption: PetVisionCaptionV3,
): PetVisionCanaryResult | null {
  const canary = PET_VISION_V3_CANARIES.find(
    (candidate) => candidate.slug === slug,
  );
  if (!canary) return null;

  const checks = canary.expectations.map((expectation) => {
    const slot = caption.visual_attributes[expectation.slot];
    const normalizedEn = normalizeCanaryText(slot.en);
    const normalizedRu = normalizeCanaryText(slot.ru);
    return {
      id: expectation.id,
      passed:
        slot.present === true &&
        (expectation.expectedAnyTermsEn.some((term) =>
          containsTerm(normalizedEn, normalizeCanaryText(term)),
        ) ||
          expectation.expectedAnyTermsRu.some((term) =>
            containsTerm(normalizedRu, normalizeCanaryText(term)),
          )),
    };
  });
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
