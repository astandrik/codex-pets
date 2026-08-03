import {
  PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
  PET_CAPTION_REWRITE_SYSTEM_PROMPT,
  parsePetVisionCaption,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";

const CAPTION_REWRITE_ENDPOINT =
  "https://ai.api.cloud.yandex.net/v1/chat/completions";

export type CaptionRewriteFailureReason =
  | "authentication_error"
  | "invalid_request"
  | "invalid_response"
  | "provider_error"
  | "rate_limited"
  | "refused"
  | "structured_output_unsupported"
  | "timeout";

export class CaptionRewriteProviderError extends Error {
  constructor(public readonly reason: CaptionRewriteFailureReason) {
    super("Caption rewrite provider request failed.");
    this.name = "CaptionRewriteProviderError";
  }
}

export type YandexCaptionRewriteClient = {
  rewriteCaption: (
    upstreamCaption: PetVisionCaption,
  ) => Promise<PetVisionCaption>;
};

type YandexCaptionRewriteClientOptions = {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export function createYandexCaptionRewriteClient(
  options: YandexCaptionRewriteClientOptions,
): YandexCaptionRewriteClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return { rewriteCaption };

  async function rewriteCaption(
    upstreamCaption: PetVisionCaption,
  ): Promise<PetVisionCaption> {
    const validatedCaption = parsePetVisionCaption(upstreamCaption);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchImpl(CAPTION_REWRITE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${options.apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Project": options.folderId,
        },
        body: JSON.stringify({
          model: options.modelUri,
          messages: [
            {
              role: "system",
              content: PET_CAPTION_REWRITE_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify(validatedCaption),
            },
          ],
          temperature: 0,
          stream: false,
          max_tokens: 900,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pet_visual_caption_rewrite_v1",
              strict: true,
              schema: PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CaptionRewriteProviderError(
          httpFailureReason(response.status),
        );
      }
      return await parseProviderResponse(response);
    } catch (error) {
      if (error instanceof CaptionRewriteProviderError) throw error;
      if (controller.signal.aborted) {
        throw new CaptionRewriteProviderError("timeout");
      }
      throw new CaptionRewriteProviderError("provider_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseProviderResponse(
  response: Response,
): Promise<PetVisionCaption> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CaptionRewriteProviderError("invalid_response");
  }
  if (!payload || typeof payload !== "object") {
    throw new CaptionRewriteProviderError("invalid_response");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new CaptionRewriteProviderError("invalid_response");
  }
  const message =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as { message?: unknown }).message
      : null;
  if (!message || typeof message !== "object") {
    throw new CaptionRewriteProviderError("invalid_response");
  }
  if (
    "refusal" in message &&
    typeof (message as { refusal?: unknown }).refusal === "string"
  ) {
    throw new CaptionRewriteProviderError("refused");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    throw new CaptionRewriteProviderError("invalid_response");
  }
  try {
    return parsePetVisionCaption(JSON.parse(content));
  } catch {
    throw new CaptionRewriteProviderError("invalid_response");
  }
}

function httpFailureReason(
  status: number,
): CaptionRewriteFailureReason {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) {
    return "structured_output_unsupported";
  }
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}
