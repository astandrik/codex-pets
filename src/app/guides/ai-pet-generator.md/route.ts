import { markdownResponse } from "@/lib/agent-markdown";
import { AI_PET_GENERATOR_PATH, buildAiPetGeneratorMarkdown } from "@/lib/guides/ai-pet-generator";

export function GET(): Response {
  return markdownResponse(buildAiPetGeneratorMarkdown(), { canonicalPath: AI_PET_GENERATOR_PATH });
}
