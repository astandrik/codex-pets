export const RELATED_PETS_ANNOTATION_CONTROL_REVISION =
  "related-pets-annotation-control-2026-08-v11-r3";

export const RELATED_PETS_ANNOTATION_ALIASES = Object.freeze({
  entities: Object.freeze({}),
  franchises: Object.freeze({
    ffxii: "final-fantasy-xii",
    "final-fantasy-12": "final-fantasy-xii",
    wh40k: "warhammer-40000",
    "warhammer-40k": "warhammer-40000",
  }),
  franchiseFamilies: Object.freeze({
    ffx: "final-fantasy",
    ffxii: "final-fantasy",
    "final-fantasy-12": "final-fantasy",
  }),
  collections: Object.freeze({}),
  specificArchetypes: Object.freeze({}),
  themes: Object.freeze({}),
  mediaOrigins: Object.freeze({}),
});

export const RELATED_PETS_ANNOTATION_OVERRIDES = Object.freeze({
  "2b-2": Object.freeze({
    reason: "The card confirms the 2B name and an android archetype, but the Nier-inspired tag is not an exact franchise identifier.",
    entity: "2b",
    aliases: Object.freeze([]),
    franchises: Object.freeze([]),
    franchiseFamilies: Object.freeze([]),
    collections: Object.freeze([]),
    specificArchetypes: Object.freeze(["android"]),
    themes: Object.freeze([]),
    mediaOrigins: Object.freeze([]),
  }),
  cheburashka: Object.freeze({
    reason: "The card confirms the named character and the Soviet animation collection; no broader franchise family is stated.",
    franchiseFamilies: Object.freeze([]),
    collections: Object.freeze(["soviet-animation"]),
  }),
  "chibi-wolf": Object.freeze({
    reason: "The card identifies a cartoon wolf but does not state a media-origin category.",
    mediaOrigins: Object.freeze([]),
  }),
  "ffx-yuna": Object.freeze({
    reason: "The description explicitly identifies Final Fantasy X.",
    franchiseFamilies: Object.freeze(["final-fantasy"]),
  }),
  "frieren-2": Object.freeze({
    reason: "The card says only that the pet is inspired by Frieren; no exact franchise identifier is stated.",
    franchises: Object.freeze([]),
  }),
  jinx: Object.freeze({
    reason: "The card has an Arcane tag but does not state a media-origin category.",
    mediaOrigins: Object.freeze([]),
  }),
  lain: Object.freeze({
    reason: "The card confirms the Lain name and wired theme but does not state an exact franchise or media origin.",
    entity: "lain",
    aliases: Object.freeze([]),
    franchises: Object.freeze([]),
    franchiseFamilies: Object.freeze([]),
    collections: Object.freeze([]),
    specificArchetypes: Object.freeze([]),
    themes: Object.freeze(["wired"]),
    mediaOrigins: Object.freeze([]),
  }),
  johnny: Object.freeze({
    reason: "The description identifies Johnny Silverhand but does not state an exact franchise identifier.",
    franchises: Object.freeze([]),
  }),
  "karlson-2": Object.freeze({
    reason: "The card identifies Karlson but does not state an exact franchise identifier.",
    franchises: Object.freeze([]),
  }),
  "mai-shiranui": Object.freeze({
    reason: "The fighting-game tag directly confirms a video-game origin.",
    mediaOrigins: Object.freeze(["video-game"]),
  }),
  "megumin-3": Object.freeze({
    reason: "The description explicitly names KonoSuba but does not state a collection or media-origin category.",
    franchiseFamilies: Object.freeze(["konosuba"]),
    collections: Object.freeze([]),
    mediaOrigins: Object.freeze([]),
  }),
  "paprika-2": Object.freeze({
    reason: "The card describes the character and appearance but does not state a specific archetype.",
    specificArchetypes: Object.freeze([]),
  }),
  "ryuk-2": Object.freeze({
    reason: "The card describes a Ryuk-inspired shinigami but does not state an exact franchise identifier.",
    franchises: Object.freeze([]),
  }),
  sakura: Object.freeze({
    reason: "The description confirms a kunoichi archetype but no exact franchise.",
    franchises: Object.freeze([]),
    specificArchetypes: Object.freeze(["kunoichi"]),
  }),
  "sunny-sprout": Object.freeze({
    reason: "The card identifies Neznayka but does not state an exact franchise identifier.",
    franchises: Object.freeze([]),
  }),
  "round-bear": Object.freeze({
    reason: "This Winnie-the-Pooh card depicts the Soviet animated adaptation.",
    collections: Object.freeze(["soviet-animation"]),
  }),
  "foggy-hedgehog": Object.freeze({
    reason: "The named character belongs to the Soviet animation collection.",
    collections: Object.freeze(["soviet-animation"]),
  }),
});
