export function buildPetInstallCommand(slug: string): string {
  return `npx @astandrik/codex-pets install ${slug}`;
}
