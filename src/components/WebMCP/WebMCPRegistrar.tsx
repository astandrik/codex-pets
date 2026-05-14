"use client";

import { useEffect } from "react";

import { withBasePath } from "@/lib/base-path";
import {
  createAgentPet,
  enrichManifestPet,
  isWebMCPPetInput,
  normalizeSearchCodexPetsInput,
  readSafeSlugInput,
  WEBMCP_MAX_PET_LIMIT,
} from "@/components/WebMCP/webmcp-utils";
import {
  registerWebMCPTools,
  toolError,
  toolResult,
  type WebMCPTool,
} from "@/components/WebMCP/webmcp-runtime";

type PetsResponse = {
  total?: number;
  pets?: unknown[];
};

type PetResponse = {
  pet?: unknown;
  error?: string;
};

type ManifestResponse = {
  generatedAt?: string;
  total?: number;
  pets?: Array<Record<string, unknown>>;
};

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Optional search text matched against pet name, description, or tags.",
    },
    kind: {
      type: "string",
      enum: ["all", "creature", "object", "character"],
      description: "Optional pet kind filter. Use all to search every kind.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: WEBMCP_MAX_PET_LIMIT,
      description: "Maximum number of pets to return.",
    },
  },
  additionalProperties: false,
};

const SLUG_SCHEMA = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description: "Approved Codex pet slug, for example zero-two-2.",
    },
  },
  required: ["slug"],
  additionalProperties: false,
};

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export function WebMCPRegistrar() {
  useEffect(() => registerWebMCPTools(createSiteTools()), []);
  return null;
}

function createSiteTools(): WebMCPTool[] {
  return [
    {
      name: "search_codex_pets",
      title: "Search Codex Pets",
      description:
        "Search approved Codex pet packs in Companion Gallery by name, description, tag, or kind.",
      inputSchema: SEARCH_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: searchCodexPets,
    },
    {
      name: "get_codex_pet",
      title: "Get Codex Pet",
      description:
        "Get public metadata, asset URLs, page URL, and install command for one approved Codex pet pack.",
      inputSchema: SLUG_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: getCodexPet,
    },
    {
      name: "get_codex_pets_manifest",
      title: "Get Codex Pets Manifest",
      description:
        "Get the current public manifest of approved Codex pet packs in Companion Gallery.",
      inputSchema: EMPTY_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: getCodexPetsManifest,
    },
  ];
}

async function searchCodexPets(input: unknown) {
  const { query, kind, limit } = normalizeSearchCodexPetsInput(input);
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (kind !== "all") params.set("kind", kind);

  const response = await fetchJson<PetsResponse>(
    `${withBasePath("/api/pets")}${params.size ? `?${params}` : ""}`,
  );
  if (!response.ok) {
    return toolError(response.error);
  }

  const origin = window.location.origin;
  const pets = Array.isArray(response.data.pets)
    ? response.data.pets.filter(isWebMCPPetInput).slice(0, limit)
    : [];
  const agentPets = pets.map((pet) => createAgentPet(pet, origin));
  const total =
    typeof response.data.total === "number" ? response.data.total : agentPets.length;

  return toolResult(
    `Found ${agentPets.length} approved Codex pet pack${agentPets.length === 1 ? "" : "s"}.`,
    {
      total,
      returned: agentPets.length,
      truncated: total > agentPets.length,
      query: query ?? null,
      kind,
      pets: agentPets,
    },
  );
}

async function getCodexPet(input: unknown) {
  const slug = readSafeSlugInput(input);
  if (!slug) {
    return toolError("Provide a valid Codex pet slug.");
  }

  const response = await fetchJson<PetResponse>(
    withBasePath(`/api/pets/${encodeURIComponent(slug)}`),
  );
  if (!response.ok) {
    return toolError(response.error);
  }

  if (!isWebMCPPetInput(response.data.pet)) {
    return toolError(`No approved Codex pet found for slug ${slug}.`);
  }

  const pet = createAgentPet(response.data.pet, window.location.origin);
  return toolResult(`Found ${pet.displayName}.`, { pet });
}

async function getCodexPetsManifest() {
  const response = await fetchJson<ManifestResponse>(withBasePath("/api/manifest"));
  if (!response.ok) {
    return toolError(response.error);
  }

  const origin = window.location.origin;
  const pets = Array.isArray(response.data.pets)
    ? response.data.pets.map((pet) => enrichManifestPet(pet, origin))
    : [];
  const total = typeof response.data.total === "number" ? response.data.total : pets.length;

  return toolResult(
    `The Companion Gallery manifest contains ${total} approved Codex pet pack${total === 1 ? "" : "s"}.`,
    {
      manifest: {
        ...response.data,
        total,
        pets,
      },
    },
  );
}

async function fetchJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    const data = (await response.json()) as T;

    if (!response.ok) {
      return { ok: false, error: `Request failed with status ${response.status}.` };
    }

    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Request failed: ${message}` };
  }
}
