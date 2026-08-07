import type { PetVisionCaption } from "../src/lib/pets/search-vision-contract";
import type { VisionCaptionDiagnostic } from "../src/lib/pets/search-vision-provider.mjs";

export function main(argv?: string[]): Promise<unknown>;

export function createVisionProvider(
  config: {
    folderId: string;
    apiKey: string;
    modelUri: string;
    visionTimeoutMs: number;
  },
  overrides?: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    randomUUID?: () => string;
    onDiagnostic?: (diagnostic: VisionCaptionDiagnostic) => void;
  },
): (frames: readonly {
  state: string;
  row: number;
  frame: number;
  dataUrl: string;
}[]) => Promise<PetVisionCaption>;
