export const RELATED_PETS_REBUILD_COMMANDS = Object.freeze([
  "npm run related:rebuild -- --dry-run",
  "npm run related:rebuild -- --apply",
]);

export function createRelatedPetsRebuildRequiredLog() {
  return {
    action: "related-pets-rebuild-required",
    commands: [...RELATED_PETS_REBUILD_COMMANDS],
  };
}
