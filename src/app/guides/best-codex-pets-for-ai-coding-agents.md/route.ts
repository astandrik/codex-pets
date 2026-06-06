import { unstable_cache } from "next/cache";

import { markdownResponse } from "@/lib/agent-markdown";
import {
  buildBestCodexPetGuideSections,
  buildBestCodexPetsGuideMarkdown,
} from "@/lib/guides/best-codex-pets";
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
    await getApprovedPetsSnapshot(),
  );

  return markdownResponse(buildBestCodexPetsGuideMarkdown(sections));
}
