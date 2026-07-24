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
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createYandexVisionCaptionClient(
  options: YandexVisionCaptionClientOptions,
): YandexVisionCaptionClient {
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
    let request = await startRequest(frames);
    try {
      if (request.response.status === 429 || request.response.status >= 500) {
        const retryDelayMs = retryAfterMs(
          request.response.headers.get("Retry-After"),
          now(),
        );
        await cancelResponseBody(request.response);
        request.finish();
        if (retryDelayMs > 0) await sleep(retryDelayMs);
        request = await startRequest(frames);
      }

      if (!request.response.ok) {
        await cancelResponseBody(request.response);
        throw new VisionCaptionProviderError(
          httpFailureReason(request.response.status),
        );
      }
      try {
        const caption = await parseProviderResponse(request.response);
        if (request.signal.aborted) {
          throw new VisionCaptionProviderError("timeout");
        }
        return caption;
      } catch (error) {
        if (request.signal.aborted) {
          throw new VisionCaptionProviderError("timeout");
        }
        throw error;
      }
    } finally {
      request.finish();
    }
  }

  async function startRequest(
    frames: readonly PetVisionFrame[],
  ): Promise<{
    response: Response;
    signal: AbortSignal;
    finish: () => void;
  }> {
    const waitMs = Math.max(0, nextStartAt - now());
    if (waitMs > 0) await sleep(waitMs);
    const startedAt = now();
    nextStartAt = Math.max(nextStartAt, startedAt) + START_INTERVAL_MS;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(VISION_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${options.apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Project": options.folderId,
        },
        body: JSON.stringify({
          model: options.modelUri,
          messages: [
            { role: "system", content: PET_VISION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: PET_VISION_USER_PROMPT },
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
              name: "pet_visual_caption_v1",
              strict: true,
              schema: PET_VISION_RESPONSE_JSON_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });
      return {
        response,
        signal: controller.signal,
        finish: () => clearTimeout(timeout),
      };
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw new VisionCaptionProviderError("timeout", { cause: error });
      }
      if (error instanceof VisionCaptionProviderError) throw error;
      throw new VisionCaptionProviderError("provider_error", { cause: error });
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
): Promise<PetVisionCaption> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VisionCaptionProviderError("invalid_response");
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
    return parsePetVisionCaption(JSON.parse(content));
  } catch {
    throw new VisionCaptionProviderError("invalid_response");
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not replace the provider outcome.
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
