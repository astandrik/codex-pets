export interface PublicBuildEnvironment {
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_BASE_PATH?: string;
  CODEX_PETS_BUILT_PUBLIC_APP_URL?: string;
  CODEX_PETS_BUILT_PUBLIC_BASE_PATH?: string;
}

export function validatePublicBuildConfig(
  environment: PublicBuildEnvironment,
): void;
