import type { PetVisionCaption } from "./search-vision-contract";
import type { PetVisionFrame } from "./search-vision-frames";
import type {
  StructuredResponseDiagnostic,
  StructuredResponseFailureReason,
} from "./responses-structured-provider.mjs";

export type VisionCaptionFailureReason = StructuredResponseFailureReason;
export type VisionCaptionDiagnostic = StructuredResponseDiagnostic;

export class VisionCaptionRequestError extends Error {
  readonly reason: VisionCaptionFailureReason;
  readonly diagnostics: Partial<VisionCaptionDiagnostic>;
  constructor(
    reason: VisionCaptionFailureReason,
    diagnostics?: Partial<VisionCaptionDiagnostic>,
  );
}

export const RESPONSES_VISION_ENDPOINT: string;

export function createResponsesVisionRequest(input: {
  modelUri: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
  responseJsonSchema: object;
  parseCaption?: (value: unknown) => unknown;
  frames: readonly PetVisionFrame[];
  maxOutputTokens: number;
}): object;

export function createResponsesVisionCaptionRequester<
  T = PetVisionCaption,
>(options: {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
  responseJsonSchema: object;
  expectedFrames: readonly Omit<PetVisionFrame, "png" | "dataUrl">[];
  parseCaption: (value: unknown) => T;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  reserveStart?: () => Promise<void>;
  onDiagnostic?: (diagnostic: VisionCaptionDiagnostic) => void;
}): (frames: readonly PetVisionFrame[]) => Promise<T>;
