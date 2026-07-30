import { unstable_cache } from "next/cache";

import { markdownResponse } from "@/lib/agent-markdown";
import {
  buildVsVsCodePetsGuideMarkdown,
  VS_VSCODE_PETS_GUIDE_PATH,
} from "@/lib/guides/codex-pets-vs-vscode-pets";
import { loadGuidePets } from "@/lib/guides/load-guide-pets";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPetsForSearch(),
  [
    "vs-vscode-pets-guide-markdown",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export async function GET(): Promise<Response> {
  const response = markdownResponse(
    buildVsVsCodePetsGuideMarkdown(await loadGuidePets(getApprovedPetsSnapshot)),
    { canonicalPath: VS_VSCODE_PETS_GUIDE_PATH },
  );
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  return response;
}
