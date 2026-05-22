const JSON_LD_ESCAPE_PATTERN = /[<>&]/g;
const JSON_LD_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
};

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(
    JSON_LD_ESCAPE_PATTERN,
    (char) => JSON_LD_ESCAPES[char],
  );
}
