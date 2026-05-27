import { apiNotFoundResponse } from "@/app/api/api-not-found-response";

export const runtime = "nodejs";

export function GET(): Response {
  return apiNotFoundResponse();
}

export function POST(): Response {
  return apiNotFoundResponse();
}

export function PUT(): Response {
  return apiNotFoundResponse();
}

export function PATCH(): Response {
  return apiNotFoundResponse();
}

export function DELETE(): Response {
  return apiNotFoundResponse();
}
