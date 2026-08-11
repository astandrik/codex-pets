import {
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  buildRelatedPetAnnotationInput,
  parseRelatedPetAnnotationProposal,
  type RelatedPetAnnotationInput,
  type RelatedPetAnnotationProposal,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  StructuredResponseRequestError,
  createResponsesStructuredRequester,
  type StructuredResponseDiagnostic,
  type StructuredResponseFailureReason,
} from "@/lib/pets/responses-structured-provider.mjs";

const START_INTERVAL_MS = 6_000;

export type { StructuredResponseFailureReason as AnnotationFailureReason };

export class RelatedPetAnnotationProviderError extends Error {
  constructor(
    public readonly reason: StructuredResponseFailureReason,
    options?: ErrorOptions,
  ) {
    super("Related pet annotation provider request failed.", options);
    this.name = "RelatedPetAnnotationProviderError";
  }
}

export type YandexRelatedPetAnnotationClient = {
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
};

type YandexRelatedPetAnnotationClientOptions = {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  onDiagnostic?: (diagnostic: StructuredResponseDiagnostic) => void;
};

export function createYandexRelatedPetAnnotationClient(
  options: YandexRelatedPetAnnotationClientOptions,
): YandexRelatedPetAnnotationClient {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let queue = Promise.resolve();
  const requestProposal = createResponsesStructuredRequester<
    RelatedPetAnnotationInput,
    RelatedPetAnnotationProposal
  >({
    ...options,
    systemPrompt: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
    responseSchemaName: "related_pet_annotation_v11",
    responseJsonSchema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
    buildContent: (pet) => [
      {
        type: "input_text",
        text: [
          RELATED_PETS_ANNOTATION_USER_PROMPT,
          buildRelatedPetAnnotationInput(pet),
        ].join("\n\n"),
      },
    ],
    parseValue: parseRelatedPetAnnotationProposal,
    reserveStart,
    onDiagnostic: options.onDiagnostic ??
      ((diagnostic) =>
        console.info("[codex-pets][related-pet-annotation-provider]", diagnostic)),
  });

  return {
    createProposal(pet) {
      const run = () => requestProposal(pet).catch((error: unknown) => {
        if (error instanceof StructuredResponseRequestError) {
          throw new RelatedPetAnnotationProviderError(error.reason);
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
