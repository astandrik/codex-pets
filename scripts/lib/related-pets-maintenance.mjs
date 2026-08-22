export const RELATED_PETS_REBUILD_COMMANDS = Object.freeze([
  "npm run related:rebuild -- --dry-run",
  "npm run related:rebuild -- --apply",
]);

export function buildRelatedPetsDerivedBackfillCommands(slugs) {
  return slugs.flatMap((slug) => [
    `npm run related:backfill-description-query -- --apply --slug ${slug}`,
    `npm run related:backfill-description-document -- --apply --slug ${slug}`,
    `npm run related:backfill-annotations -- --apply --slug ${slug}`,
    `npm run related:backfill-annotation-query -- --apply --slug ${slug}`,
    `npm run related:backfill-annotation-document -- --apply --slug ${slug}`,
  ]);
}

export function createRelatedPetsRebuildRequiredLog() {
  return {
    action: "related-pets-rebuild-required",
    commands: [...RELATED_PETS_REBUILD_COMMANDS],
  };
}
