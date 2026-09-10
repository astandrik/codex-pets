import type {
  RelatedPetAnnotationInput,
  RelatedPetAnnotationProposal,
  RelatedPetAnnotationValidationIssue,
} from "./related-pets-annotation-contract.mjs";
import type {
  StructuredResponseDiagnostic,
  StructuredResponseFailureReason,
} from "./responses-structured-provider.mjs";

export type { StructuredResponseFailureReason as AnnotationFailureReason };

export type AnnotationDiagnostic = Omit<
  StructuredResponseDiagnostic,
  "api" | "status" | "incompleteReason"
> & {
  api: "chat_completions";
  finishReason?: string;
  validationIssues?: RelatedPetAnnotationValidationIssue[];
};

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
  proposalRevision?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  onDiagnostic?: (diagnostic: AnnotationDiagnostic) => void;
}): YandexRelatedPetAnnotationClient;
