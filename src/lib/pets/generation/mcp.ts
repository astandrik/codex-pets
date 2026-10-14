import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { petGeneration } from "@/lib/pets/generation/service";
import { GenerationError, generationInputSchema, GENERATION_ID } from "@/lib/pets/generation/model";
import { trackMcpToolCall } from "@/lib/metrics/yandex-measurement";
import { GENERATION_EXPERIMENT_NOTICE } from "@/lib/pets/generation/disclosure";
import { publicGenerationError } from "@/lib/pets/generation/public-error";

export function registerPetGenerationTools(server: McpServer, clientIp: string | null) {
  server.registerTool("generate_pet", {
    title: "Generate an animated pet",
    description: "Use only when the user requests a new animated pet from a text brief. Starts one server-paid pet generation task (twelve image stages, each with at most one delayed retry after a retryable provider failure, plus one text/vision request for an editable name, description and tags). Supply a fresh random UUID requestId; reuse it unchanged when retrying the same request. Limits: 200 accepted tasks/day globally, 10/IP by default, Moscow time. Admin IP allowances can add attempts until midnight; the global cap and budget still apply. Returns a task ID; poll get_pet_generation. The result is unlisted and expires after 24 hours. Do not use to publish a pet, edit an image, or create a manual administrator request. " + GENERATION_EXPERIMENT_NOTICE,
    inputSchema: generationInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => runGenerationTool("generate_pet", () => petGeneration.generate(input, clientIp)));
  server.registerTool("get_pet_generation", {
    title: "Get pet generation status and files",
    description: "Use to read your generation task by its private generationId. Completed results include a preview, editable name/description/tags in metadata, and downloadable pet.json, spritesheet and ZIP. Edit metadata on the private preview before submitting for moderation; this read tool never edits or starts a paid retry. Failed results include error.code, message, hint and automaticRetry=false: stop polling and explain the failure. Do not use to list other tasks, publish results, or start another paid generation; use generate_pet only for a new user-requested task.",
    inputSchema: { generationId: z.string().regex(GENERATION_ID) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ generationId }) => runGenerationTool("get_pet_generation", () => petGeneration.get(generationId)));
}

async function runGenerationTool(tool: "generate_pet" | "get_pet_generation", run: () => Promise<object>) {
  try {
    const value = await run();
    await trackMcpToolCall({ tool, status: "success" });
    return { structuredContent: { generation: value }, content: [{ type: "text" as const, text: JSON.stringify({ generation: value }) }] };
  } catch (error) {
    const value = { error: { ...publicGenerationError(error instanceof GenerationError ? error.code : "generation_unavailable", error instanceof GenerationError ? error.providerFailure : undefined, error instanceof GenerationError ? error.limitScope : undefined), ...(error instanceof GenerationError && error.retryAt ? { retryAt: error.retryAt } : {}) } };
    await trackMcpToolCall({ tool, status: "error" });
    return { isError: true, structuredContent: value, content: [{ type: "text" as const, text: JSON.stringify(value) }] };
  }
}
