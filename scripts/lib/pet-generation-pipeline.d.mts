export const V2_ATLAS: Readonly<{ columns: 8; rows: 11; cellWidth: 192; cellHeight: 208; width: 1536; height: 2288 }>;
export const STANDARD_ROW_SPECS: ReadonlyArray<{ key: string; row: number; action: string }>;
export class PetGenerationPipelineError extends Error { code: string }
export type PipelineIssue = {
  row: number | null;
  frame: number | null;
  category: string;
  severity: "warning" | "error";
  message: string;
};
export function generatePetBase(input: Record<string, unknown>): Promise<{ image: Buffer; requestId: string | null; usage: Record<string, unknown> }>;
export function hatchV2Pet(input: Record<string, unknown>): Promise<{
  artifacts: Array<{ key: string; stage: string; fileName: string; contentType: string; buffer: Buffer }>;
  qa: {
    pass: boolean;
    issues: PipelineIssue[];
    atlas: typeof V2_ATLAS;
    despillPasses: 1;
    lookDirections: Array<{ index: number; row: number; column: number; degrees: number }>;
  };
  review: { pass: boolean; issues: PipelineIssue[] } | null;
  chroma: string;
}>;
export function chooseChromaColor(baseImage: Buffer): Promise<number[]>;
export function processGrid(input: { buffer: Buffer; columns: number; rows: number; chroma: number[]; rowIndex: number | null }):
  Promise<{ frames: Buffer[]; issues: PipelineIssue[] }>;
export function assembleAtlas(rows: Buffer[][]): Promise<Buffer>;
