export const MAX_DESCRIPTION_LENGTH: number;

export type DescriptionUpdate = {
  slug: string;
  description: string;
};

export type CurrentPetDescription = {
  description: string;
  status: string;
};

export function parseUpdateArgs(argv: string[]): {
  file: string;
  apply: boolean;
};

export function readDescriptionUpdates(filePath: string): DescriptionUpdate[];

export function assertAllSlugsFound(
  updates: DescriptionUpdate[],
  currentPets: Map<string, CurrentPetDescription>,
): void;

export function buildEmbeddingBackfillCommands(slugs: string[]): string[];
