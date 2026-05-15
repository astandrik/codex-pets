import { toPublicUrl } from "@/lib/base-path";
import {
  getPetIdleStripUrl,
  getPetPreviewUrl,
} from "@/lib/pets/asset-urls";
import { spriteDimensions } from "@/lib/pets/sprite-rendering";
import type { PetKind, PublicPet } from "@/lib/pets/types";
import {
  buildAgentBadgeCode,
  buildAgentCardCode,
  buildAgentEmbedCode,
  buildAgentInstallPrompt,
  buildAgentInstallInstructions,
  type AgentBadgeCode,
  type AgentCardCode,
  type AgentEmbedCode,
  type AgentInstallInstructions,
} from "@/lib/pets/agent-snippets";

export const AGENT_DEFAULT_PET_LIMIT = 10;
export const AGENT_MAX_PET_LIMIT = 60;
const DEFAULT_SHARE_STATE = "idle";
const DEFAULT_SHARE_SCALE = 2;

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PET_KINDS = new Set<PetKind>(["creature", "object", "character"]);

export type AgentPet = {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
  status: "approved";
  author: {
    name: string;
  };
  pageUrl: string;
  petJsonUrl: string;
  manifestUrl: string;
  spritesheetUrl: string;
  zipUrl: string;
  packageUrl: string;
  previewImageUrl: string | null;
  idleStripUrl: string | null;
  installCommand: string;
  installPrompt: string;
  install: AgentInstallInstructions;
  badge: AgentBadgeCode;
  card: AgentCardCode;
  embed: AgentEmbedCode;
  compatibleWith: ["codex"];
  license: "unknown";
  validation: {
    status: "valid";
    source: "registry_approval";
    messages: string[];
  };
  createdAt: string;
  approvedAt: string | null;
};

export type AgentSearchFilters = {
  query?: string;
  kind: PetKind | "all";
  tags: string[];
  author?: string;
  compatibleWith: string[];
  limit: number;
};

export function createAgentPet(pet: PublicPet): AgentPet {
  const pageUrl = toPublicUrl(`/pets/${encodeURIComponent(pet.slug)}`);
  const petJsonUrl = toAgentPublicUrl(pet.petJsonUrl);
  const spritesheetUrl = toAgentPublicUrl(pet.spritesheetUrl);
  const zipUrl = toAgentPublicUrl(pet.zipUrl);
  const previewImageUrl = getPetPreviewUrl(pet.spritesheetUrl);
  const idleStripUrl = getPetIdleStripUrl(pet.spritesheetUrl);
  const svgUrl = toPublicUrl(`/badge/${encodeURIComponent(pet.slug)}.svg`);
  const shareParams = new URLSearchParams({
    mode: "sprite",
    scale: String(DEFAULT_SHARE_SCALE),
    state: DEFAULT_SHARE_STATE,
  });
  const gifUrl = toPublicUrl(
    `/card/${encodeURIComponent(pet.slug)}.gif?${shareParams.toString()}`,
  );
  const embedUrl = toPublicUrl(
    `/embed/${encodeURIComponent(pet.slug)}?${shareParams.toString()}`,
  );
  const spriteSize = spriteDimensions(DEFAULT_SHARE_SCALE);
  const install = buildAgentInstallInstructions({
    slug: pet.slug,
    mcpUrl: toPublicUrl("/mcp"),
    manifestUrl: petJsonUrl,
    packageUrl: zipUrl,
    spritesheetUrl,
  });

  return {
    slug: pet.slug,
    name: pet.displayName,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    tags: pet.tags,
    status: "approved",
    author: {
      name: pet.ownerName ?? "Anonymous",
    },
    pageUrl,
    petJsonUrl,
    manifestUrl: petJsonUrl,
    spritesheetUrl,
    zipUrl,
    packageUrl: zipUrl,
    previewImageUrl: previewImageUrl ? toAgentPublicUrl(previewImageUrl) : null,
    idleStripUrl: idleStripUrl ? toAgentPublicUrl(idleStripUrl) : null,
    installCommand: install.command,
    installPrompt: buildAgentInstallPrompt({
      name: pet.displayName,
      pageUrl,
    }),
    install,
    badge: buildAgentBadgeCode({
      name: pet.displayName,
      pageUrl,
      svgUrl,
    }),
    card: buildAgentCardCode({
      name: pet.displayName,
      pageUrl,
      gifUrl,
      width: spriteSize.width,
      height: spriteSize.height,
    }),
    embed: buildAgentEmbedCode({
      name: pet.displayName,
      embedUrl,
      width: spriteSize.width,
      height: spriteSize.height,
    }),
    compatibleWith: ["codex"],
    license: "unknown",
    validation: {
      status: "valid",
      source: "registry_approval",
      messages: [],
    },
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
  };
}

export function createAgentPets(pets: PublicPet[]): AgentPet[] {
  return pets.map(createAgentPet);
}

export function normalizeAgentSearchFilters(input: {
  query?: unknown;
  kind?: unknown;
  tags?: unknown;
  author?: unknown;
  compatibleWith?: unknown;
  limit?: unknown;
}): AgentSearchFilters {
  return {
    query: normalizeQuery(input.query),
    kind: normalizeKind(input.kind),
    tags: normalizeTags(input.tags),
    author: normalizeQuery(input.author),
    compatibleWith: normalizeCompatibleWith(input.compatibleWith),
    limit: normalizeAgentLimit(input.limit),
  };
}

export function filterAgentPets(
  pets: PublicPet[],
  filters: AgentSearchFilters,
): PublicPet[] {
  if (!isCompatibleWithCodex(filters.compatibleWith)) {
    return [];
  }

  const query = filters.query?.toLowerCase();
  const author = filters.author?.toLowerCase();
  const tags = filters.tags.map((tag) => tag.toLowerCase());

  return pets.filter((pet) => {
    if (filters.kind !== "all" && pet.kind !== filters.kind) return false;

    if (
      query &&
      !pet.displayName.toLowerCase().includes(query) &&
      !pet.description.toLowerCase().includes(query) &&
      !pet.tags.some((tag) => tag.toLowerCase().includes(query))
    ) {
      return false;
    }

    if (
      tags.length > 0 &&
      !tags.every((tag) =>
        pet.tags.some((petTag) => petTag.toLowerCase() === tag),
      )
    ) {
      return false;
    }

    if (author && !(pet.ownerName ?? "").toLowerCase().includes(author)) {
      return false;
    }

    return true;
  }).slice(0, filters.limit);
}

export function readSafeAgentSlug(value: unknown): string | null {
  const slug = typeof value === "string" ? value.trim() : "";
  return SAFE_SLUG.test(slug) ? slug : null;
}

export function readSafeBadgeSlug(file: string): string | null {
  if (!file.endsWith(".svg")) return null;
  return readSafeAgentSlug(file.slice(0, -4));
}

export function readSafeCardSlug(file: string): string | null {
  if (!file.endsWith(".gif")) return null;
  return readSafeAgentSlug(file.slice(0, -4));
}

export function normalizeAgentLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim() || AGENT_DEFAULT_PET_LIMIT)
        : AGENT_DEFAULT_PET_LIMIT;

  if (!Number.isFinite(parsed)) {
    return AGENT_DEFAULT_PET_LIMIT;
  }

  return Math.min(
    AGENT_MAX_PET_LIMIT,
    Math.max(1, Math.floor(parsed)),
  );
}

export function toAgentPublicUrl(value: string): string {
  return value.startsWith("/") ? toPublicUrl(value) : value;
}

function normalizeQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const query = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return query || undefined;
}

function normalizeKind(value: unknown): PetKind | "all" {
  if (value === undefined || value === null || value === "" || value === "all") {
    return "all";
  }

  return typeof value === "string" && PET_KINDS.has(value as PetKind)
    ? (value as PetKind)
    : "all";
}

function normalizeTags(value: unknown): string[] {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.replace(/\s+/g, " ").trim().slice(0, 48))
        .filter(Boolean),
    ),
  );
}

function normalizeCompatibleWith(value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return ["codex"];
  }

  const rawValues = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      rawValues
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function isCompatibleWithCodex(values: string[]): boolean {
  return values.length === 0 || values.every((value) => value === "codex");
}
