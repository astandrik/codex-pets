import type {
  VisionBackfillOptions,
  VisionBackfillCaptionRevision,
} from "./lib/pet-vision-search-backfill.mjs";

export function preflightPetVisionBackfillInvocation(
  options: VisionBackfillOptions,
  environment: NodeJS.ProcessEnv,
): {
  captionRevision: VisionBackfillCaptionRevision;
  visualRevision: string;
  dimensions: number;
  captionContract: {
    modelName: string;
    schemaVersion: 1 | 2 | 3;
    responseSchemaName: string;
    maxTokens: number;
    systemPrompt: string;
    userPrompt: string;
    responseJsonSchema: Readonly<Record<string, unknown>>;
  };
};

export function main(argv?: string[]): Promise<{
  scanned: number;
  unchanged: number;
  vectorOnly: number;
  captionAndVector: number;
}>;
