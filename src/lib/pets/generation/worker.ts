import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { generationStore, type GenerationStore } from "@/lib/pets/generation/store";
import { petGeneration, type createGenerationService } from "@/lib/pets/generation/service";
import { buildGeneratedPackage, buildGenerationPrompt, MAX_GENERATED_BYTES } from "@/lib/pets/generation/package";
import { GENERATION_MODEL, GenerationError, type GenerationJob, type ImageUsage } from "@/lib/pets/generation/model";

type GeneratedImage = { bytes: Buffer; usage?: ImageUsage; providerRequestId?: string; generationMs: number };
type Service = ReturnType<typeof createGenerationService>;

export function createGenerationWorker(options: {
  service: Service;
  store: GenerationStore;
  generate: (job: GenerationJob) => Promise<GeneratedImage>;
  build?: typeof buildGeneratedPackage;
  now?: () => number;
}) {
  let lastCleanup = -Infinity;
  return async function runOnce(owner: string) {
    const now = options.now ?? Date.now;
    if (now() - lastCleanup >= 60_000) {
      await options.store.cleanup(now());
      lastCleanup = now();
    }
    const job = await options.service.claim(owner);
    if (!job) return "idle";
    let processing = job;
    if (job.status === "generating") {
      let generated: GeneratedImage;
      try {
        generated = await options.generate(job);
      } catch (error) {
        await options.service.fail(job, error instanceof GenerationError ? error.code : "outcome_unknown");
        return "failed";
      }
      // A failed/ambiguous persistence acknowledgement must never trigger another paid call.
      processing = await options.service.saveSource(job, generated.bytes, {
        usage: generated.usage, providerRequestId: generated.providerRequestId,
        generationMs: generated.generationMs,
      });
    }
    const source = await options.store.readArtifact(job.id, "source.png", now());
    if (!source) {
      await options.service.fail(processing, "source_unavailable");
      return "failed";
    }
    let files: Awaited<ReturnType<typeof buildGeneratedPackage>>;
    try {
      files = await (options.build ?? buildGeneratedPackage)(processing, source);
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      await options.service.fail(processing, error.code);
      return "failed";
    }
    await options.service.finish(processing, files);
    return "completed";
  };
}

export async function generateImage(job: GenerationJob): Promise<GeneratedImage> {
  const keyFile = process.env.PET_GENERATION_OPENAI_KEY_FILE?.trim();
  const apiKey = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new GenerationError("provider_not_configured");
  const client = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 180_000 });
  const start = Date.now();
  try {
    const { data: result, request_id } = await client.images.generate({
      model: GENERATION_MODEL,
      prompt: buildGenerationPrompt(job),
      size: "1536x2288",
      quality: "high",
      background: "transparent",
      output_format: "png",
      moderation: "auto",
      n: 1,
    }).withResponse();
    const encoded = result.data?.[0]?.b64_json;
    if (result.data?.length !== 1 || !encoded || encoded.length > Math.ceil(MAX_GENERATED_BYTES / 3) * 4) throw new GenerationError("invalid_provider_result");
    const usage = result.usage;
    const imageInput = usage?.input_tokens_details?.image_tokens ?? 0;
    const textInput = usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens ?? 0;
    const measured = usage ? {
      textInputTokens: textInput, imageInputTokens: imageInput, outputTokens: usage.output_tokens,
      // GPT Image 2.5 published rates, USD per million tokens (2026-10-09).
      costUsd: (textInput * 5 + imageInput * 8 + usage.output_tokens * 30) / 1_000_000,
    } : undefined;
    return { bytes: Buffer.from(encoded, "base64"), usage: measured, providerRequestId: request_id ?? undefined, generationMs: Date.now() - start };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if (error instanceof OpenAI.APIError && error.status && error.status >= 400 && error.status < 500 && error.status !== 408) throw new GenerationError(error.status === 429 ? "provider_rate_limited" : "provider_rejected");
    throw new GenerationError("outcome_unknown");
  }
}

export const runPetGenerationWorkerOnce = createGenerationWorker({ service: petGeneration, store: generationStore, generate: generateImage });
