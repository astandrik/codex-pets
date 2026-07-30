import { unstable_cache } from "next/cache";

import { markdownResponse } from "@/lib/agent-markdown";
import {
  buildBestCodexPetGuideSections,
  buildBestCodexPetsGuideMarkdown,
} from "@/lib/guides/best-codex-pets";
import { loadGuidePets } from "@/lib/guides/load-guide-pets";
import { listApprovedPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPets(),
  [
    "best-codex-pets-guide-markdown",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export async function GET(): Promise<Response> {
  const sections = buildBestCodexPetGuideSections(
    await loadGuidePets(getApprovedPetsSnapshot),
  );

  return markdownResponse(buildBestCodexPetsGuideMarkdown(sections), {
    canonicalPath: "/guides/best-codex-pets-for-ai-coding-agents",
  });
}
