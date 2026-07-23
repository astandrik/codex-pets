import {
  PET_VISION_CAPTION_REVISION_V1,
  getPetVisionCaptionContract,
  parsePetVisionCaption,
  type PetVisionCaption,
  type PetVisionCaptionRevision,
} from "@/lib/pets/search-vision-contract";
import {
  PET_VISION_FRAME_POLICY,
  type PetVisionFrame,
} from "@/lib/pets/search-vision-frames";

const VISION_ENDPOINT = "https://ai.api.cloud.yandex.net/v1/chat/completions";
const START_INTERVAL_MS = 6_000;
const MAX_RETRY_AFTER_MS = 10_000;

export type VisionCaptionFailureReason =
  | "authentication_error"
  | "invalid_request"
  | "invalid_response"
  | "provider_error"
  | "rate_limited"
  | "refused"
  | "timeout";

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
  captionRevision?: PetVisionCaptionRevision;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createYandexVisionCaptionClient(
  options: YandexVisionCaptionClientOptions,
): YandexVisionCaptionClient {
  const captionRevision =
    options.captionRevision ?? PET_VISION_CAPTION_REVISION_V1;
  const contract = getPetVisionCaptionContract(captionRevision);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let queue = Promise.resolve();

  return {
    createCaption(frames) {
      try {
        validateFrames(frames);
      } catch (error) {
        return Promise.reject(error);
      }

      const task = queue.then(
        () => requestWithRetry(frames),
        () => requestWithRetry(frames),
      );
      queue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };

  async function requestWithRetry(
    frames: readonly PetVisionFrame[],
  ): Promise<PetVisionCaption> {
    let response = await startRequest(frames);
    if (response.status === 429 || response.status >= 500) {
      const retryDelayMs = retryAfterMs(response.headers.get("Retry-After"), now());
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      response = await startRequest(frames);
    }

    if (!response.ok) {
      throw new VisionCaptionProviderError(httpFailureReason(response.status));
    }
    return parseProviderResponse(response, captionRevision);
  }

  async function startRequest(
    frames: readonly PetVisionFrame[],
  ): Promise<Response> {
    const waitMs = Math.max(0, nextStartAt - now());
    if (waitMs > 0) await sleep(waitMs);
    const startedAt = now();
    nextStartAt = Math.max(nextStartAt, startedAt) + START_INTERVAL_MS;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await fetchImpl(VISION_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${options.apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Project": options.folderId,
        },
        body: JSON.stringify({
          model: options.modelUri,
          messages: [
            { role: "system", content: contract.systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: contract.userPrompt },
                ...frames.map((frame) => ({
                  type: "image_url",
                  image_url: { url: frame.dataUrl },
                })),
              ],
            },
          ],
          temperature: 0,
          stream: false,
          max_tokens: 900,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: contract.responseSchemaName,
              strict: true,
              schema: contract.responseJsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VisionCaptionProviderError("timeout", { cause: error });
      }
      if (error instanceof VisionCaptionProviderError) throw error;
      throw new VisionCaptionProviderError("provider_error", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateFrames(frames: readonly PetVisionFrame[]): void {
  if (frames.length !== PET_VISION_FRAME_POLICY.frames.length) {
    throw new VisionCaptionProviderError("invalid_request");
  }
  const valid = PET_VISION_FRAME_POLICY.frames.every((expected, index) => {
    const actual = frames[index];
    return (
      actual?.state === expected.state &&
      actual.row === expected.row &&
      actual.frame === expected.frame &&
      actual.dataUrl.startsWith("data:image/png;base64,")
    );
  });
  if (!valid) {
    throw new VisionCaptionProviderError("invalid_request");
  }
}

async function parseProviderResponse(
  response: Response,
  captionRevision: PetVisionCaptionRevision,
): Promise<PetVisionCaption> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new VisionCaptionProviderError("invalid_response", { cause: error });
  }
  if (!payload || typeof payload !== "object") {
    throw new VisionCaptionProviderError("invalid_response");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new VisionCaptionProviderError("invalid_response");
  }
  const message =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as { message?: unknown }).message
      : null;
  if (!message || typeof message !== "object") {
    throw new VisionCaptionProviderError("invalid_response");
  }
  if (
    "refusal" in message &&
    typeof (message as { refusal?: unknown }).refusal === "string"
  ) {
    throw new VisionCaptionProviderError("refused");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    throw new VisionCaptionProviderError("invalid_response");
  }

  try {
    if (captionRevision === PET_VISION_CAPTION_REVISION_V1) {
      return parsePetVisionCaption(captionRevision, JSON.parse(content));
    }
    return parsePetVisionCaption(captionRevision, JSON.parse(content));
  } catch (error) {
    if (error instanceof VisionCaptionProviderError) throw error;
    throw new VisionCaptionProviderError("invalid_response", { cause: error });
  }
}

function httpFailureReason(status: number): VisionCaptionFailureReason {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}

function retryAfterMs(value: string | null, timestamp: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - timestamp));
}
