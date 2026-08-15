import {
  RELATED_PETS_V24_JUDGE_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_V24_JUDGE_SCHEMA_NAME,
  RELATED_PETS_V24_JUDGE_SYSTEM_PROMPT,
  buildRelatedPetsV24JudgeInput,
  parseRelatedPetsV24JudgeResult,
  sameRelatedPetsV24JudgeDecision,
  swapRelatedPetsV24JudgeResult,
  type RelatedPetsV24JudgeCard,
  type RelatedPetsV24JudgeConfidence,
  type RelatedPetsV24JudgePreference,
  type RelatedPetsV24JudgeResult,
} from "@/lib/pets/related-pets-v24-judge-contract.mjs";
import {
  StructuredResponseRequestError,
  createResponsesStructuredRequester,
  type StructuredResponseDiagnostic,
  type StructuredResponseFailureReason,
} from "@/lib/pets/responses-structured-provider.mjs";

type JudgeInput = {
  source: RelatedPetsV24JudgeCard;
  slateA: RelatedPetsV24JudgeCard[];
  slateB: RelatedPetsV24JudgeCard[];
};

export class RelatedPetsV24JudgeProviderError extends Error {
  constructor(public readonly reason: StructuredResponseFailureReason) {
    super("Related pets V24 blind judge request failed.");
    this.name = "RelatedPetsV24JudgeProviderError";
  }
}

export function createRelatedPetsV24JudgeClient(options: {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  reserveStart?: () => Promise<void>;
  onDiagnostic?: (diagnostic: StructuredResponseDiagnostic) => void;
}) {
  const request = createResponsesStructuredRequester<JudgeInput, RelatedPetsV24JudgeResult>({
    ...options,
    reasoning: { effort: "medium" },
    initialMaxOutputTokens: 32_000,
    retryMaxOutputTokens: 64_000,
    systemPrompt: RELATED_PETS_V24_JUDGE_SYSTEM_PROMPT,
    responseSchemaName: RELATED_PETS_V24_JUDGE_SCHEMA_NAME,
    responseJsonSchema: RELATED_PETS_V24_JUDGE_RESPONSE_JSON_SCHEMA,
    buildContent: (input) => [{
      type: "input_text",
      text: buildRelatedPetsV24JudgeInput(input),
    }],
    parseValue: parseRelatedPetsV24JudgeResult,
  });
  return { judgeBlindedPair };

  async function judgeBlindedPair(input: JudgeInput) {
    try {
      const first = await request(input);
      const swapped = swapRelatedPetsV24JudgeResult(await request({
        source: input.source,
        slateA: input.slateB,
        slateB: input.slateA,
      }));
      const orderConsistent = sameRelatedPetsV24JudgeDecision(first, swapped);
      const confidence = minimumConfidence(first.confidence, swapped.confidence);
      return {
        requests: 2 as const,
        orderConsistent,
        decision: {
          preference: agreed(first.preference, swapped.preference),
          top4: agreed(first.top4, swapped.top4),
          top8: agreed(first.top8, swapped.top8),
        },
        baselineGrades: averageGrades(first.slateAGrades, swapped.slateAGrades),
        candidateGrades: averageGrades(first.slateBGrades, swapped.slateBGrades),
        confidence,
        needsManualReview: !orderConsistent || confidence === "low",
      };
    } catch (error) {
      if (error instanceof StructuredResponseRequestError) {
        throw new RelatedPetsV24JudgeProviderError(error.reason);
      }
      throw error;
    }
  }
}

function agreed(
  left: RelatedPetsV24JudgePreference,
  right: RelatedPetsV24JudgePreference,
) {
  return left === right ? left : null;
}

function minimumConfidence(
  left: RelatedPetsV24JudgeConfidence,
  right: RelatedPetsV24JudgeConfidence,
) {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[left] <= rank[right] ? left : right;
}

function averageGrades(
  left: Array<{ position: number; grade: 0 | 1 | 2 | 3 }>,
  right: Array<{ position: number; grade: 0 | 1 | 2 | 3 }>,
) {
  return left.map(({ position, grade }, index) => {
    const counterpart = right[index];
    if (!counterpart || counterpart.position !== position) {
      throw new Error("Related pets V24 judge grade positions do not match.");
    }
    return (grade + counterpart.grade) / 2;
  });
}
