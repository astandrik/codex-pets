import { encode } from "@toon-format/toon";

export const TOON_MEDIA_TYPE = "text/toon";
export const TOON_CONTENT_TYPE = `${TOON_MEDIA_TYPE}; charset=utf-8`;
export const JSON_MEDIA_TYPE = "application/json";

export function toonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", TOON_CONTENT_TYPE);

  return new Response(encode(body), {
    ...init,
    headers,
  });
}

export function alternateLinkHeader(url: string, type: string): string {
  return `<${url}>; rel="alternate"; type="${type}"`;
}
