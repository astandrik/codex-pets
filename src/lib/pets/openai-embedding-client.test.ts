import { describe, expect, it, vi } from "vitest";
import { createPrivateOpenAIEmbeddingClient, validatePrivateEmbeddingEndpoint } from "@/lib/pets/openai-embedding-client";
import { validateAMSProxy } from "@/lib/pets/embedding-worker/transport";
import { OPENAI_PETS_REVISIONS, OPENAI_EMBEDDING_MODEL, isOpenAIPetsProfile } from "@/lib/pets/openai-embedding-profile";
import {
  buildPetSearchDocument,
} from "@/lib/pets/search/search-embeddings";
import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
} from "@/lib/pets/related/related-pets-embeddings";
import { buildRelatedPetDescriptionText } from "@/lib/pets/related/related-pets-semantics.mjs";
const endpoint = "http://pets-embeddings:8090/embeddings";
describe("private OpenAI embedding contract", () => {
  it("keeps intended full description templates when model revision changes", () => {
    const pet = { slug: "cat", displayName: "Cat", kind: "creature" as const, description: "A furry cat", tags: ["cute"] };
    expect(buildRelatedPetQuery(pet, OPENAI_PETS_REVISIONS.descriptionQuery)).toBe(buildRelatedPetDescriptionText(pet));
    expect(buildRelatedPetDocument(pet, OPENAI_PETS_REVISIONS.descriptionDocument)).toBe(buildRelatedPetDescriptionText(pet));
    expect(buildPetSearchDocument(pet)).toContain("tags: cute");
  });
  it("uses private service only and retains normalized query caching", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ model: OPENAI_EMBEDDING_MODEL,
      data: [{ embedding: [1, ...Array(3071).fill(0)] }] }));
    const client = createPrivateOpenAIEmbeddingClient({ endpoint, token: "internal", revision: OPENAI_PETS_REVISIONS.search, timeoutMs: 1000, fetchImpl });
    await client.embedQuery("kitten"); await client.embedQuery("kitten");
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0][0]).toBe(endpoint);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("never falls back directly on AMS/service failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("AMS unavailable"); });
    const client = createPrivateOpenAIEmbeddingClient({ endpoint, token: "internal", revision: OPENAI_PETS_REVISIONS.search, timeoutMs: 1000, fetchImpl });
    await expect(client.embedDocument("cat")).rejects.toThrow("request failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0][0]).toBe(endpoint);
  });
  it.each(["https://api.openai.com/v1/embeddings", "http://localhost:8090/embeddings", "http://pets-embeddings:8090/embeddings?url=x"])("rejects endpoint %s", (url) => {
    expect(() => validatePrivateEmbeddingEndpoint(url)).toThrow();
  });
  it("rejects direct/credentialed/arbitrary proxies", () => {
    expect(validateAMSProxy("http://172.17.0.1:18089").hostname).toBe("172.17.0.1");
    for (const value of ["", "https://api.openai.com", "http://user:pass@172.17.0.1:18089", "http://other:18089"]) expect(() => validateAMSProxy(value)).toThrow();
  });
  it("keeps legacy as the default and requires the explicit accepted OpenAI profile", () => {
    expect(isOpenAIPetsProfile({})).toBe(false);
    expect(isOpenAIPetsProfile({ PET_EMBEDDING_PROFILE: "openai-large-v1" })).toBe(true);
    expect(() => isOpenAIPetsProfile({ PET_EMBEDDING_PROFILE: "unknown" })).toThrow("unsupported_pets_embedding_profile");
  });
});
