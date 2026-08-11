import { describe, expect, it } from "vitest";

import {
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "@/lib/pets/related-pets-annotation-client";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "An Arcane fighter.",
  kind: "character" as const,
  tags: ["arcane"],
};
const proposal = {
  entity: {
    key: "vi",
    aliases: ["Violet"],
    confidence: "high",
    evidence: ["name"],
  },
  franchises: [
    { key: "arcane", confidence: "high", evidence: ["description"] },
  ],
  franchise_families: [],
  collections: [],
  specific_archetypes: [],
  themes: [],
  media_origins: [],
};

describe("related pet annotation client", () => {
  it("uses text-only structured Responses and redacted diagnostics", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const diagnostics: unknown[] = [];
    const client = createYandexRelatedPetAnnotationClient({
      folderId: "folder-1",
      apiKey: "SECRET_KEY",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      onDiagnostic: (entry) => diagnostics.push(entry),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return completedResponse(proposal);
      },
    });

    await expect(client.createProposal(pet)).resolves.toMatchObject({
      entity: { key: "vi" },
    });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      instructions: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
      temperature: 0,
      max_output_tokens: 8_000,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "related_pet_annotation_v11_r4",
          strict: true,
          schema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
        },
      },
    });
    expect(body.input[0].content).toHaveLength(1);
    expect(body.input[0].content[0].type).toBe("input_text");
    expect(body.input[0].content[0].text).toContain(
      RELATED_PETS_ANNOTATION_USER_PROMPT,
    );
    expect(JSON.stringify(body)).not.toContain("input_image");
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET_KEY");
    expect(JSON.stringify(diagnostics)).not.toContain("An Arcane fighter");
    expect(JSON.stringify(diagnostics)).not.toContain("Violet");
  });

  it("serializes provider starts", async () => {
    let timestamp = 0;
    const starts: number[] = [];
    const client = createYandexRelatedPetAnnotationClient({
      folderId: "folder-1",
      apiKey: "key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      now: () => timestamp,
      sleep: async (milliseconds) => {
        timestamp += milliseconds;
      },
      fetchImpl: async () => {
        starts.push(timestamp);
        return completedResponse(proposal);
      },
    });

    await Promise.all([client.createProposal(pet), client.createProposal(pet)]);
    expect(starts).toEqual([0, 6_000]);
  });

  it("surfaces terminal refusal without leaking its body", async () => {
    const client = createYandexRelatedPetAnnotationClient({
      folderId: "folder-1",
      apiKey: "key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      fetchImpl: async () => Response.json({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "refusal", refusal: "SECRET_REFUSAL" }],
        }],
      }),
    });

    await expect(client.createProposal(pet)).rejects.toMatchObject({
      reason: "refused",
      message: "Related pet annotation provider request failed.",
    });
  });
});

function completedResponse(value: unknown): Response {
  return Response.json({
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    }],
  });
}
