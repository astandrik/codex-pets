const MAX_PUBLIC_SLUG_LENGTH = 64;
const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u",
  æ: "ae", œ: "oe", ß: "ss", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th",
};

export function parsePublicPetSlug(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_PUBLIC_SLUG_LENGTH &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) ? value : null;
}

export function suggestPublicPetSlug(name: string): string {
  return Array.from(name.normalize("NFC").toLowerCase(), (letter) => TRANSLITERATION[letter] ?? letter).join("")
    .normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, MAX_PUBLIC_SLUG_LENGTH).replace(/-+$/g, "");
}

export function appendPublicPetSlugSuffix(base: string, suffix: string, maxLength = MAX_PUBLIC_SLUG_LENGTH): string {
  if (!parsePublicPetSlug(base) || !parsePublicPetSlug(suffix) || !Number.isInteger(maxLength) ||
      maxLength > MAX_PUBLIC_SLUG_LENGTH || maxLength <= suffix.length + 1) {
    throw new Error("invalid_public_slug_suffix");
  }
  const prefix = base.slice(0, maxLength - suffix.length - 1).replace(/-+$/g, "");
  if (!prefix) throw new Error("invalid_public_slug_suffix");
  return `${prefix}-${suffix}`;
}
