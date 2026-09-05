export const RELATED_PETS_REBUILD_COMMANDS: readonly string[];

export function buildRelatedPetsDerivedBackfillCommands(
  slugs: string[],
): string[];

export function createRelatedPetsRebuildRequiredLog(): {
  action: "related-pets-rebuild-required";
  commands: string[];
};
