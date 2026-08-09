export class OpenAIProviderError extends Error {
  constructor(message: string, options?: {
    code?: string;
    status?: number | null;
    responseReceived?: boolean;
    requestId?: string | null;
  });
  code: string;
  status: number | null;
  responseReceived: boolean;
  requestId: string | null;
}
export type OpenAIPetGenerationProvider = {
  moderate(input: { text?: string; image?: Buffer }): Promise<{ flagged: boolean; requestId: string | null }>;
  generateImage(input: { prompt: string; size: string; references?: Buffer[] }): Promise<{
    image: Buffer; requestId: string | null; usage: Record<string, unknown>;
  }>;
  review(input: { contactSheet: Buffer; directionSheet: Buffer }): Promise<{
    review: { pass: boolean; issues: Array<{ row: number | null; frame: number | null; category: string; severity: "warning" | "error"; message: string }> };
    requestId: string | null;
    usage: Record<string, unknown>;
  }>;
};
export function createOpenAIPetGenerationProvider(options: {
  apiKey: string;
  baseUrl?: string;
  imageModel: string;
  reviewModel: string;
  fetchImpl?: typeof fetch;
}): OpenAIPetGenerationProvider;
