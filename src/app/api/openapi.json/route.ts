import { GET as getOpenApiJson } from "@/app/openapi.json/route";

export const runtime = "nodejs";

export function GET(): Response {
  return getOpenApiJson();
}
