import {
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SCHEMA_NAME,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_TOKEN_POLICY,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  buildRelatedPetAnnotationInput,
  parseRelatedPetAnnotationProposal,
} from "./related-pets-annotation-contract.mjs";
import {
  StructuredResponseRequestError,
  createResponsesStructuredRequester,
} from "./responses-structured-provider.mjs";

const START_INTERVAL_MS = 6_000;

export class RelatedPetAnnotationProviderError extends Error {
  constructor(reason, options) {
    super("Related pet annotation provider request failed.", options);
    this.name = "RelatedPetAnnotationProviderError";
    this.reason = reason;
  }
}

export function createYandexRelatedPetAnnotationClient(options) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let reservationQueue = Promise.resolve();
  const requestProposal = createResponsesStructuredRequester({
    ...options,
    systemPrompt: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
    responseSchemaName: RELATED_PETS_ANNOTATION_SCHEMA_NAME,
    responseJsonSchema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
    reasoning: undefined,
    initialMaxOutputTokens:
      RELATED_PETS_ANNOTATION_TOKEN_POLICY.initialMaxOutputTokens,
    retryMaxOutputTokens:
      RELATED_PETS_ANNOTATION_TOKEN_POLICY.retryMaxOutputTokens,
    buildContent: (pet) => [{
      type: "input_text",
      text: [
        RELATED_PETS_ANNOTATION_USER_PROMPT,
        buildRelatedPetAnnotationInput(pet),
      ].join("\n\n"),
    }],
    parseValue: parseRelatedPetAnnotationProposal,
    reserveStart,
    onDiagnostic: options.onDiagnostic ??
      ((diagnostic) =>
        console.info("[codex-pets][related-pet-annotation-provider]", diagnostic)),
  });

  return {
    createProposal(pet) {
      return requestProposal(pet).catch((error) => {
        if (error instanceof StructuredResponseRequestError) {
          throw new RelatedPetAnnotationProviderError(error.reason, {
            cause: error,
          });
        }
        throw error;
      });
    },
  };

  function reserveStart() {
    const reservation = reservationQueue.then(async () => {
      const waitMs = Math.max(0, nextStartAt - now());
      if (waitMs > 0) await sleep(waitMs);
      const startedAt = now();
      nextStartAt = Math.max(nextStartAt, startedAt) + START_INTERVAL_MS;
    });
    reservationQueue = reservation.catch(() => undefined);
    return reservation;
  }
}
