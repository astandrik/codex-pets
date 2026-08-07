import {
  PET_VISION_RESPONSE_JSON_SCHEMA,
  PET_VISION_SYSTEM_PROMPT,
  PET_VISION_USER_PROMPT,
  parsePetVisionCaption,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY,
  type PetVisionFrame,
} from "@/lib/pets/search-vision-frames";
import {
  createResponsesVisionCaptionRequester,
  VisionCaptionRequestError,
  type VisionCaptionDiagnostic,
  type VisionCaptionFailureReason,
} from "@/lib/pets/search-vision-provider.mjs";

const START_INTERVAL_MS = 6_000;

export type { VisionCaptionFailureReason };

export class VisionCaptionProviderError extends Error {
  constructor(
    public readonly reason: VisionCaptionFailureReason,
    options?: ErrorOptions,
  ) {
    super("Vision caption provider request failed.", options);
    this.name = "VisionCaptionProviderError";
  }
}

export type YandexVisionCaptionClient = {
  createCaption: (
    frames: readonly PetVisionFrame[],
  ) => Promise<PetVisionCaption>;
};

type YandexVisionCaptionClientOptions = {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  onDiagnostic?: (diagnostic: VisionCaptionDiagnostic) => void;
};

export function createYandexVisionCaptionClient(
  options: YandexVisionCaptionClientOptions,
): YandexVisionCaptionClient {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let queue = Promise.resolve();
  const requestCaption = createResponsesVisionCaptionRequester({
    ...options,
    systemPrompt: PET_VISION_SYSTEM_PROMPT,
    userPrompt: PET_VISION_USER_PROMPT,
    responseSchemaName: "pet_visual_caption_v1",
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA,
    expectedFrames: PET_VISION_FRAME_POLICY.frames,
    parseCaption: parsePetVisionCaption,
    reserveStart,
    onDiagnostic:
      options.onDiagnostic ??
      ((diagnostic) =>
        console.info("[codex-pets][pet-vision-provider]", diagnostic)),
  });

  return {
    createCaption(frames) {
      const run = () =>
        requestCaption(frames).catch((error: unknown) => {
          if (error instanceof VisionCaptionRequestError) {
            throw new VisionCaptionProviderError(error.reason);
          }
          throw error;
        });
      const task = queue.then(run, run);
      queue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };

  async function reserveStart(): Promise<void> {
    const waitMs = Math.max(0, nextStartAt - now());
    if (waitMs > 0) await sleep(waitMs);
    const startedAt = now();
    nextStartAt = Math.max(nextStartAt, startedAt) + START_INTERVAL_MS;
  }
}
