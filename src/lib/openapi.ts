import { getPublicOrigin, toPublicUrl, withBasePath } from "@/lib/base-path";
import { SITE_DESCRIPTION } from "@/lib/site-metadata";

const jsonObject = {
  type: "object",
  additionalProperties: true,
} as const;

const errorResponse = {
  description: "Request failed.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
} as const;

const jsonRpcErrorResponse = {
  description: "MCP JSON-RPC error response.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/JsonRpcErrorResponse" },
    },
  },
} as const;

const notFoundResponse = {
  description: "Resource not found.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
} as const;

const publicReadSecurity = [] as const;

export function buildOpenApiSpec() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Codex Pets API",
      version: "1.0.0",
      description:
        `${SITE_DESCRIPTION} This OpenAPI document describes version 1 of the public agent/developer contract subset: approved registry data, MCP discovery, markdown discovery docs, pricing and terms discovery, and public submission workflows. Existing unversioned URLs are stable v1 endpoints. Additive changes may appear without notice; breaking public-agent contract changes require a new path or a published deprecation notice. Public metric mutation and download redirect routes are intentionally outside this contract.`,
      contact: {
        name: "Codex Pets",
        url: toPublicUrl("/about"),
      },
    },
    servers: [
      {
        url: getOpenApiServerUrl(),
      },
    ],
    tags: [
      { name: "Discovery", description: "Machine-readable site and API metadata." },
      { name: "Pets", description: "Approved public Codex pet registry data." },
      { name: "MCP", description: "Read-only agent tool integration." },
      { name: "Requests", description: "Public pet generation request workflow." },
      { name: "Submissions", description: "Public pet pack submission workflow." },
    ],
    paths: {
      "/openapi.json": {
        get: {
          operationId: "getOpenApiSpec",
          tags: ["Discovery"],
          summary: "Get the Codex Pets OpenAPI specification",
          description:
            "Returns the canonical OpenAPI 3.1 JSON document for the public Codex Pets API.",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/OpenApiDocument"),
          },
        },
      },
      "/api/openapi.json": {
        get: {
          operationId: "getOpenApiSpecAlias",
          tags: ["Discovery"],
          summary: "Get the Codex Pets OpenAPI specification alias",
          description:
            "Predictable API-prefixed alias for agents that probe /api/openapi.json.",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/OpenApiDocument"),
          },
        },
      },
      "/llms.txt": {
        get: {
          operationId: "getLlmsTxt",
          tags: ["Discovery"],
          summary: "Get concise LLM discovery context",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/plain"),
          },
        },
      },
      "/llms-full.txt": {
        get: {
          operationId: "getLlmsFullTxt",
          tags: ["Discovery"],
          summary: "Get full LLM-readable Codex Pets documentation",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/plain"),
          },
        },
      },
      "/index.md": {
        get: {
          operationId: "getIndexMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown homepage fallback",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/about.md": {
        get: {
          operationId: "getAboutMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown about page",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/agents.md": {
        get: {
          operationId: "getAgentsMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown agent access guide",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/developers.md": {
        get: {
          operationId: "getDevelopersMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown developer portal",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/developers/llms.txt": {
        get: {
          operationId: "getDevelopersLlmsTxt",
          tags: ["Discovery"],
          summary: "Get scoped developer LLM discovery context",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/plain"),
          },
        },
      },
      "/docs/api.md": {
        get: {
          operationId: "getApiDocsMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown API docs",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/docs/llms.txt": {
        get: {
          operationId: "getDocsLlmsTxt",
          tags: ["Discovery"],
          summary: "Get scoped API LLM discovery context",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/plain"),
          },
        },
      },
      "/mcp.md": {
        get: {
          operationId: "getMcpMarkdown",
          tags: ["Discovery", "MCP"],
          summary: "Get markdown MCP server guide",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/auth.md": {
        get: {
          operationId: "getAuthMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown auth notes",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/pricing": {
        get: {
          operationId: "getPricingPage",
          tags: ["Discovery"],
          summary: "Get Codex Pets pricing page",
          description:
            "Human-readable pricing page. Codex Pets public registry access is free and best-effort with no paid plans or SLA.",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/html"),
          },
        },
      },
      "/pricing.md": {
        get: {
          operationId: "getPricingMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown pricing notes",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/terms": {
        get: {
          operationId: "getTermsPage",
          tags: ["Discovery"],
          summary: "Get Codex Pets terms page",
          description:
            "Human-readable public use terms, moderation notes, and versioning policy.",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/html"),
          },
        },
      },
      "/terms.md": {
        get: {
          operationId: "getTermsMarkdown",
          tags: ["Discovery"],
          summary: "Get markdown public use terms",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/markdown"),
          },
        },
      },
      "/.well-known/oauth-protected-resource": {
        get: {
          operationId: "getOAuthProtectedResourceMetadata",
          tags: ["Discovery"],
          summary: "Get OAuth Protected Resource metadata for Codex Pets",
          description:
            "Machine-readable public access metadata. OAuth 2.0 is not supported and authorization_servers is intentionally omitted.",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/OAuthProtectedResourceMetadata"),
          },
        },
      },
      "/.well-known/oauth-protected-resource/mcp": {
        get: {
          operationId: "getMcpOAuthProtectedResourceMetadata",
          tags: ["Discovery", "MCP"],
          summary: "Get OAuth Protected Resource metadata for the MCP endpoint",
          description:
            "Machine-readable public access metadata for /mcp. OAuth 2.0 is not supported and authorization_servers is intentionally omitted.",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/OAuthProtectedResourceMetadata"),
          },
        },
      },
      "/server.json": {
        get: {
          operationId: "getMcpRegistryServer",
          tags: ["MCP"],
          summary: "Get MCP Registry server metadata",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/McpRegistryServer"),
          },
        },
      },
      "/.well-known/mcp/server.json": {
        get: {
          operationId: "getWellKnownMcpRegistryServer",
          tags: ["MCP"],
          summary: "Get well-known MCP Registry server metadata",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/McpRegistryServer"),
          },
        },
      },
      "/.well-known/mcp": {
        get: {
          operationId: "getWellKnownMcp",
          tags: ["MCP"],
          summary: "Get well-known MCP server metadata",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/McpRegistryServer"),
          },
        },
        post: {
          operationId: "callWellKnownMcp",
          tags: ["MCP"],
          summary: "Call the Codex Pets MCP server at the well-known endpoint",
          security: publicReadSecurity,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JsonRpcRequest" },
              },
            },
          },
          responses: {
            "200": jsonResponse("#/components/schemas/JsonRpcResponse"),
            "403": jsonRpcErrorResponse,
            "500": jsonRpcErrorResponse,
          },
        },
      },
      "/.well-known/mcp/server-card.json": {
        get: {
          operationId: "getMcpServerCard",
          tags: ["MCP"],
          summary: "Get Codex Pets MCP server card",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/McpServerCard"),
          },
        },
      },
      "/mcp": {
        post: {
          operationId: "callMcp",
          tags: ["MCP"],
          summary: "Call the Codex Pets Streamable HTTP MCP server",
          description:
            "JSON-RPC endpoint for read-only MCP tools: search_pets, get_pet, get_install_instructions, get_badge_code, get_embed_code, get_card_code, and get_pet_request_info.",
          security: publicReadSecurity,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JsonRpcRequest" },
              },
            },
          },
          responses: {
            "200": jsonResponse("#/components/schemas/JsonRpcResponse"),
            "403": jsonRpcErrorResponse,
            "500": jsonRpcErrorResponse,
          },
        },
      },
      "/api/manifest": {
        get: {
          operationId: "getManifest",
          tags: ["Pets"],
          summary: "List approved Codex pets for agents and the CLI",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/ManifestResponse"),
          },
        },
      },
      "/api/manifest.toon": {
        get: {
          operationId: "getManifestToon",
          tags: ["Pets"],
          summary: "List approved Codex pets as TOON",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/toon"),
          },
        },
      },
      "/api/pets": {
        get: {
          operationId: "searchPets",
          tags: ["Pets"],
          summary: "Search approved Codex pets",
          description:
            "Returns approved pets only. Private contact fields are never included.",
          security: publicReadSecurity,
          parameters: petSearchParameters,
          responses: {
            "200": jsonResponse("#/components/schemas/PetsResponse"),
          },
        },
      },
      "/api/pets.toon": {
        get: {
          operationId: "searchPetsToon",
          tags: ["Pets"],
          summary: "Search approved Codex pets as TOON",
          security: publicReadSecurity,
          parameters: petSearchParameters,
          responses: {
            "200": textResponse("text/toon"),
          },
        },
      },
      "/api/pets/{slug}": {
        get: {
          operationId: "getPet",
          tags: ["Pets"],
          summary: "Get one approved Codex pet",
          security: publicReadSecurity,
          parameters: [slugParameter],
          responses: {
            "200": jsonResponse("#/components/schemas/PetDetailResponse"),
            "404": notFoundResponse,
          },
        },
      },
      "/api/pets/{slug}.toon": {
        get: {
          operationId: "getPetToon",
          tags: ["Pets"],
          summary: "Get one approved Codex pet as TOON",
          security: publicReadSecurity,
          parameters: [slugParameter],
          responses: {
            "200": textResponse("text/toon"),
            "404": textResponse("text/toon"),
          },
        },
      },
      "/api/tags": {
        get: {
          operationId: "getTags",
          tags: ["Pets"],
          summary: "List approved pet tag counts",
          security: publicReadSecurity,
          responses: {
            "200": jsonResponse("#/components/schemas/TagsResponse"),
          },
        },
      },
      "/api/tags.toon": {
        get: {
          operationId: "getTagsToon",
          tags: ["Pets"],
          summary: "List approved pet tag counts as TOON",
          security: publicReadSecurity,
          responses: {
            "200": textResponse("text/toon"),
          },
        },
      },
      "/api/pets/{slug}/share": {
        get: {
          operationId: "getPetShareSnippets",
          tags: ["Pets"],
          summary: "Get share snippets for an approved Codex pet",
          security: publicReadSecurity,
          parameters: [slugParameter],
          responses: {
            "200": jsonResponse("#/components/schemas/PetShareResponse"),
            "400": errorResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/pets/{slug}/install": {
        get: {
          operationId: "getPetInstallInstructions",
          tags: ["Pets"],
          summary: "Get install instructions for an approved Codex pet",
          description:
            "Read-only install instruction endpoint. GET does not increment install counters.",
          security: publicReadSecurity,
          parameters: [slugParameter],
          responses: {
            "200": jsonResponse("#/components/schemas/PetInstallResponse"),
            "400": errorResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/generation-requests": {
        post: {
          operationId: "createPetGenerationRequest",
          tags: ["Requests"],
          summary: "Create a public Codex pet generation request",
          description:
            "Accepts anonymous requests. If an app session is present, the request is associated with the signed-in user.",
          security: publicReadSecurity,
          parameters: [idempotencyKeyHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateGenerationRequest" },
              },
              "multipart/form-data": {
                schema: { $ref: "#/components/schemas/CreateGenerationRequestForm" },
              },
            },
          },
          responses: {
            "201": jsonResponse("#/components/schemas/CreateGenerationRequestResponse"),
            "400": errorResponse,
            "409": errorResponse,
            "503": errorResponse,
          },
        },
      },
      "/api/submissions/register": {
        post: {
          operationId: "registerPetSubmission",
          tags: ["Submissions"],
          summary: "Submit a Codex pet pack for moderation",
          description:
            "Uploads pet.json, spritesheet.webp or spritesheet.png, and a ZIP containing both files at the root. Approved pets appear in the public registry after moderation.",
          security: publicReadSecurity,
          parameters: [idempotencyKeyHeader],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: { $ref: "#/components/schemas/RegisterSubmissionForm" },
              },
            },
          },
          responses: {
            "201": jsonResponse("#/components/schemas/RegisterSubmissionResponse"),
            "400": errorResponse,
            "409": errorResponse,
            "503": errorResponse,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        AppSessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "codex_pets_session",
          description:
            "Optional app-session cookie used by browser account flows. Public read endpoints do not require it.",
        },
        ProxyBasic: {
          type: "http",
          scheme: "basic",
          description:
            "Deployment mode for trusted reverse proxies. Public agent endpoints are designed to be readable without credentials.",
        },
      },
      schemas: {
        OpenApiDocument: jsonObject,
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
            hint: { type: "string" },
            field: { type: "string" },
          },
          required: ["error", "code", "message"],
          additionalProperties: true,
        },
        JsonRpcRequest: jsonObject,
        JsonRpcResponse: jsonObject,
        JsonRpcErrorResponse: {
          type: "object",
          required: ["jsonrpc", "error", "id"],
          properties: {
            jsonrpc: { type: "string", const: "2.0" },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "integer" },
                message: { type: "string" },
              },
              additionalProperties: true,
            },
            id: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "null" },
              ],
            },
          },
          additionalProperties: true,
        },
        McpRegistryServer: jsonObject,
        McpServerCard: jsonObject,
        OAuthProtectedResourceMetadata: {
          type: "object",
          required: [
            "resource",
            "resource_name",
            "resource_documentation",
            "resource_policy_uri",
            "resource_tos_uri",
            "oauth_unsupported",
            "scopes_supported",
            "bearer_methods_supported",
          ],
          properties: {
            resource: { type: "string", format: "uri" },
            resource_name: { type: "string" },
            resource_documentation: { type: "string", format: "uri" },
            resource_policy_uri: { type: "string", format: "uri" },
            resource_tos_uri: { type: "string", format: "uri" },
            oauth_unsupported: { type: "boolean", const: true },
            scopes_supported: {
              type: "array",
              items: { type: "string" },
              maxItems: 0,
            },
            bearer_methods_supported: {
              type: "array",
              items: { type: "string" },
              maxItems: 0,
            },
          },
          additionalProperties: true,
        },
        ManifestResponse: {
          type: "object",
          required: ["generatedAt", "total", "pets"],
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            total: { type: "integer", minimum: 0 },
            pets: {
              type: "array",
              items: { $ref: "#/components/schemas/ManifestPet" },
            },
          },
        },
        ManifestPet: {
          type: "object",
          required: [
            "slug",
            "displayName",
            "description",
            "kind",
            "tags",
            "pageUrl",
            "spritesheetUrl",
            "petJsonUrl",
            "zipUrl",
            "installCommand",
            "createdAt",
          ],
          properties: {
            slug: slugSchema,
            displayName: { type: "string" },
            description: { type: "string" },
            kind: kindSchema,
            tags: tagsSchema,
            submittedBy: nullableString,
            submittedByUrl: nullableString,
            submittedByAvatarUrl: nullableString,
            pageUrl: { type: "string", format: "uri" },
            spritesheetUrl: { type: "string" },
            petJsonUrl: { type: "string" },
            zipUrl: { type: "string" },
            installCommand: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            approvedAt: nullableDateTime,
          },
        },
        PetsResponse: {
          type: "object",
          required: ["total", "pets"],
          properties: {
            total: { type: "integer", minimum: 0 },
            pets: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicPet" },
            },
          },
        },
        PetDetailResponse: {
          type: "object",
          required: ["pet"],
          properties: {
            pet: { $ref: "#/components/schemas/PublicPet" },
          },
        },
        PublicPet: {
          type: "object",
          required: [
            "id",
            "slug",
            "displayName",
            "description",
            "spritesheetUrl",
            "petJsonUrl",
            "zipUrl",
            "spritesheetExt",
            "kind",
            "tags",
            "status",
            "createdAt",
            "downloadCount",
            "installCount",
            "likeCount",
          ],
          properties: {
            id: { type: "string" },
            slug: slugSchema,
            displayName: { type: "string" },
            description: { type: "string" },
            spritesheetUrl: { type: "string" },
            petJsonUrl: { type: "string" },
            zipUrl: { type: "string" },
            spritesheetExt: { type: "string", enum: ["webp", "png"] },
            kind: kindSchema,
            tags: tagsSchema,
            status: { type: "string", enum: ["approved"] },
            ownerName: nullableString,
            ownerProfileSlug: nullableString,
            ownerProfileUrl: nullableString,
            ownerAvatarUrl: nullableString,
            createdAt: { type: "string", format: "date-time" },
            approvedAt: nullableDateTime,
            downloadCount: { type: "integer", minimum: 0 },
            installCount: { type: "integer", minimum: 0 },
            likeCount: { type: "integer", minimum: 0 },
          },
        },
        TagsResponse: {
          type: "object",
          required: ["generatedAt", "total", "tags"],
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            total: { type: "integer", minimum: 0 },
            tags: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "count"],
                properties: {
                  name: { type: "string" },
                  count: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
        PetShareResponse: jsonObject,
        PetInstallResponse: jsonObject,
        CreateGenerationRequest: {
          type: "object",
          required: ["contactEmail", "prompt"],
          properties: {
            contactEmail: { type: "string", format: "email" },
            requesterName: nullableString,
            displayNameHint: nullableString,
            prompt: { type: "string", maxLength: 2000 },
            kind: kindSchema,
          },
        },
        CreateGenerationRequestForm: {
          type: "object",
          required: ["contactEmail", "prompt"],
          properties: {
            contactEmail: { type: "string", format: "email" },
            requesterName: { type: "string" },
            displayNameHint: { type: "string" },
            prompt: { type: "string", maxLength: 2000 },
            kind: kindSchema,
            referenceImage: {
              type: "string",
              format: "binary",
              description: "Optional PNG, JPEG, or WebP reference image up to 5 MB.",
            },
          },
        },
        CreateGenerationRequestResponse: {
          type: "object",
          required: ["ok", "request"],
          properties: {
            ok: { type: "boolean" },
            request: {
              type: "object",
              required: ["id", "status", "createdAt"],
              properties: {
                id: { type: "string" },
                status: { type: "string", enum: ["pending"] },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        RegisterSubmissionForm: {
          type: "object",
          required: ["zip", "petjson", "sprite"],
          properties: {
            zip: { type: "string", format: "binary" },
            petjson: { type: "string", format: "binary" },
            sprite: { type: "string", format: "binary" },
            spritesheetExt: { type: "string", enum: ["webp", "png"] },
            contactEmail: { type: "string", format: "email" },
            kind: kindSchema,
            tags: {
              type: "string",
              description: "Comma-separated tag list.",
            },
          },
        },
        RegisterSubmissionResponse: jsonObject,
      },
    },
  } satisfies {
    openapi: string;
    info: Record<string, unknown>;
    servers: Array<{ url: string }>;
    tags: Array<Record<string, string>>;
    paths: Record<string, Record<string, unknown>>;
    components: Record<string, unknown>;
  };

  return spec;
}

function getOpenApiServerUrl(): string {
  const basePath = withBasePath("/");
  return `${getPublicOrigin()}${basePath === "/" ? "" : basePath}`;
}

const slugSchema = {
  type: "string",
  pattern: "^[a-z0-9][a-z0-9-]{0,47}$",
} as const;

const kindSchema = {
  type: "string",
  enum: ["creature", "object", "character"],
  default: "creature",
} as const;

const tagsSchema = {
  type: "array",
  items: { type: "string" },
} as const;

const nullableString = {
  type: ["string", "null"],
} as const;

const nullableDateTime = {
  type: ["string", "null"],
  format: "date-time",
} as const;

const slugParameter = {
  name: "slug",
  in: "path",
  required: true,
  schema: slugSchema,
  description: "Approved pet slug.",
} as const;

const petSearchParameters = [
  {
    name: "q",
    in: "query",
    required: false,
    schema: { type: "string" },
    description: "Search text matched against pet name, description, and tags.",
  },
  {
    name: "kind",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["all", "creature", "object", "character"] },
    description: "Filter by pet kind. Defaults to all.",
  },
  {
    name: "tags",
    in: "query",
    required: false,
    schema: { type: "string" },
    description: "Comma-separated tag filters.",
  },
] as const;

const idempotencyKeyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9._~-]{1,128}$",
  },
  description:
    "Optional retry key for public create operations. Reusing the same key with the same normalized request body returns the first successful 201 response after it completes; while the first request is still processing it returns 409 idempotency_key_in_progress. Reusing the key with a different body returns 409 idempotency_key_conflict. Completed idempotency records are retained for 24 hours.",
} as const;

function jsonResponse(schemaRef: string) {
  return {
    description: "Successful JSON response.",
    content: {
      "application/json": {
        schema: { $ref: schemaRef },
      },
    },
  } as const;
}

function textResponse(
  mediaType: "text/plain" | "text/toon" | "text/markdown" | "text/html",
) {
  return {
    description: "Successful text response.",
    content: {
      [mediaType]: {
        schema: { type: "string" },
      },
    },
  } as const;
}
