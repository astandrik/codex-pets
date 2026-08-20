import type {
  RelatedPetAnnotationInput,
  RelatedPetAnnotationProposal,
} from "./related-pets-annotation-contract.mjs";
import type {
  StructuredResponseDiagnostic,
  StructuredResponseFailureReason,
} from "./responses-structured-provider.mjs";

export type { StructuredResponseFailureReason as AnnotationFailureReason };

export class RelatedPetAnnotationProviderError extends Error {
  readonly reason: StructuredResponseFailureReason;
  constructor(reason: StructuredResponseFailureReason, options?: ErrorOptions);
}

export type YandexRelatedPetAnnotationClient = {
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
};

export function createYandexRelatedPetAnnotationClient(options: {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  onDiagnostic?: (diagnostic: StructuredResponseDiagnostic) => void;
}): YandexRelatedPetAnnotationClient;
