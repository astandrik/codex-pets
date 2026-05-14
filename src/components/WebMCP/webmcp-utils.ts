import { withBasePath } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PetKind, PublicPet } from "@/lib/pets/types";

export const WEBMCP_DEFAULT_PET_LIMIT = 10;
export const WEBMCP_MAX_PET_LIMIT = 60;

const PET_KINDS = new Set<PetKind>(["creature", "object", "character"]);
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type WebMCPPetInput = Omit<
  Pick<
    PublicPet,
    | "slug"
    | "displayName"
    | "description"
    | "spritesheetUrl"
    | "petJsonUrl"
    | "zipUrl"
    | "kind"
    | "tags"
    | "status"
    | "ownerName"
    | "createdAt"
    | "approvedAt"
  >,
  "status"
> & {
  status: "approved";
};

export type AgentPet = Omit<
  WebMCPPetInput,
  | "slug"
  | "petJsonUrl"
  | "spritesheetUrl"
  | "zipUrl"
> & {
  slug: string;
  pageUrl: string;
  petJsonUrl: string;
  spritesheetUrl: string;
  zipUrl: string;
  installCommand: string;
};

export type SearchCodexPetsInput = {
  query?: string;
  kind: PetKind | "all";
  limit: number;
};

export function normalizeSearchCodexPetsInput(
  input: unknown,
): SearchCodexPetsInput {
  const record = isRecord(input) ? input : {};
  const query = normalizeQuery(record.query);

  return {
    ...(query ? { query } : {}),
    kind: normalizeSearchKind(record.kind),
    limit: normalizeLimit(record.limit),
  };
}

export function normalizeSearchKind(value: unknown): PetKind | "all" {
  if (value === "all" || value === undefined || value === null || value === "") {
    return "all";
  }

  return typeof value === "string" && PET_KINDS.has(value as PetKind)
    ? (value as PetKind)
    : "all";
}

export function normalizeLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim() || WEBMCP_DEFAULT_PET_LIMIT)
        : WEBMCP_DEFAULT_PET_LIMIT;

  if (!Number.isFinite(parsed)) {
    return WEBMCP_DEFAULT_PET_LIMIT;
  }

  return Math.min(
    WEBMCP_MAX_PET_LIMIT,
    Math.max(1, Math.floor(parsed)),
  );
}

export function readSafeSlugInput(input: unknown): string | null {
  const slug = isRecord(input) && typeof input.slug === "string"
    ? input.slug.trim()
    : "";

  return SAFE_SLUG.test(slug) ? slug : null;
}

export function isWebMCPPetInput(value: unknown): value is WebMCPPetInput {
  if (!isRecord(value)) return false;

  return (
    typeof value.slug === "string" &&
    typeof value.displayName === "string" &&
    typeof value.description === "string" &&
    typeof value.spritesheetUrl === "string" &&
    typeof value.petJsonUrl === "string" &&
    typeof value.zipUrl === "string" &&
    PET_KINDS.has(value.kind as PetKind) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    value.status === "approved" &&
    (value.ownerName === null || typeof value.ownerName === "string") &&
    typeof value.createdAt === "string" &&
    (value.approvedAt === null || typeof value.approvedAt === "string")
  );
}

export function createAgentPet(pet: WebMCPPetInput, origin: string): AgentPet {
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    tags: pet.tags,
    status: pet.status,
    ownerName: pet.ownerName,
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
    pageUrl: absoluteSiteUrl(`/pets/${pet.slug}`, origin),
    petJsonUrl: absoluteUrl(pet.petJsonUrl, origin),
    spritesheetUrl: absoluteUrl(pet.spritesheetUrl, origin),
    zipUrl: absoluteUrl(pet.zipUrl, origin),
    installCommand: buildPetInstallCommand(pet.slug),
  };
}

export function enrichManifestPet(
  pet: Record<string, unknown>,
  origin: string,
): Record<string, unknown> {
  const slug = typeof pet.slug === "string" ? pet.slug : "";

  return {
    ...pet,
    ...(slug ? { pageUrl: absoluteSiteUrl(`/pets/${slug}`, origin) } : {}),
    ...(slug ? { installCommand: buildPetInstallCommand(slug) } : {}),
    spritesheetUrl:
      typeof pet.spritesheetUrl === "string"
        ? absoluteUrl(pet.spritesheetUrl, origin)
        : pet.spritesheetUrl,
    petJsonUrl:
      typeof pet.petJsonUrl === "string"
        ? absoluteUrl(pet.petJsonUrl, origin)
        : pet.petJsonUrl,
    zipUrl:
      typeof pet.zipUrl === "string" ? absoluteUrl(pet.zipUrl, origin) : pet.zipUrl,
  };
}

export function absoluteSiteUrl(path: string, origin: string): string {
  return new URL(withBasePath(path), origin).toString();
}

function normalizeQuery(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const query = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return query || undefined;
}

function absoluteUrl(value: string, origin: string): string {
  return new URL(value, origin).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
