import { markdownResponse } from "@/lib/agent-markdown";
import {
  buildHowCodexPetsWorksMarkdown,
  HOW_CODEX_PETS_WORKS_PATH,
} from "@/lib/guides/how-codex-pets-works";

export const dynamic = "force-static";

export function GET(): Response {
  const response = markdownResponse(buildHowCodexPetsWorksMarkdown(), {
    canonicalPath: HOW_CODEX_PETS_WORKS_PATH,
  });
  response.headers.set(
    "Cache-Control",
    "public, max-age=300, s-maxage=86400",
  );
  return response;
}
