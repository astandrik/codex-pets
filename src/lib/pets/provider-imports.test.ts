import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const importCode = `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
globalThis.fetch = () => { throw new Error("unexpected_network"); };
register(pathToFileURL(path.resolve("scripts/lib/related-pets-typescript-loader.mjs")), {
  parentURL: pathToFileURL(process.cwd() + "/"),
  data: { sourceRootUrl: pathToFileURL(path.resolve("src")).href },
});
for (const file of [
  "src/lib/pets/search/search-runtime.ts",
  "src/lib/pets/search/search-vision-runtime.ts",
  "src/lib/pets/related/related-pets-annotation-runtime.ts",
  "src/lib/pets/related/related-pets-query-runtime.ts",
  "src/lib/pets/related/related-pets-rebuild-trigger.ts",
]) await import(pathToFileURL(path.resolve(file)));
console.log("factories-imported");
const providers = await import(pathToFileURL(path.resolve("src/lib/pets/search/search-provider-runtime.ts")));
`;

function runIsolated(environment: Record<string, string>, operation: string): string {
  return execFileSync(process.execPath, ["--input-type=module", "-e", importCode + operation], {
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...environment },
  }).trim();
}

const reportConfigurationFailure = `
try { providers.getPetSearchProviders(); console.log("unexpected-success"); }
catch (error) { console.log(error.code ?? error.message); }
`;

describe("provider initialization", () => {
  it("imports injected factories before validating production retry settings", () => {
    expect(runIsolated({ PET_METADATA_MAX_ATTEMPTS: "invalid" }, reportConfigurationFailure))
      .toBe("factories-imported\nmetadata_max_attempts_invalid");
  });

  it("reads a configured token file only when production providers are requested", () => {
    expect(runIsolated({
      PET_EMBEDDING_PROFILE: "openai-large-v1",
      PET_EMBEDDING_SERVICE_URL: "http://pets-embeddings:8090/embeddings",
      PET_EMBEDDING_SERVICE_TOKEN_FILE: join(tmpdir(), `missing-pet-token-${randomUUID()}`),
    }, reportConfigurationFailure)).toBe("factories-imported\nENOENT");
  });

  it("keeps promise and best-effort failure contracts when initialization fails", () => {
    expect(runIsolated({ PET_METADATA_MAX_ATTEMPTS: "invalid" }, `
const search = await import(pathToFileURL(path.resolve("src/lib/pets/search/search-runtime.ts")));
const vision = await import(pathToFileURL(path.resolve("src/lib/pets/search/search-vision-runtime.ts")));
const related = await import(pathToFileURL(path.resolve("src/lib/pets/related/related-pets-query-runtime.ts")));
const rebuild = await import(pathToFileURL(path.resolve("src/lib/pets/related/related-pets-rebuild-trigger.ts")));
const pending = search.searchApprovedPets();
console.log(pending instanceof Promise);
console.log(await pending.then(() => "unexpected-success", (error) => error.message));
console.log(await vision.refreshApprovedPetVisionSearchBestEffort({ status: "approved" }));
console.log(JSON.stringify(await related.refreshApprovedPetRelatedDescriptionEmbeddings({ status: "approved" })));
console.log(await rebuild.rebuildRelatedPetsBestEffort({ trigger: "owner-delete", includeVisual: false }));
`)).toBe('factories-imported\ntrue\nmetadata_max_attempts_invalid\nfalse\n{"descriptionQuery":"failed","descriptionDocument":"failed"}\nfalse');
  });

  it("retains one provider snapshot after successful initialization", () => {
    expect(runIsolated({}, `
const first = providers.getPetSearchProviders();
process.env.PET_METADATA_MAX_ATTEMPTS = "invalid";
console.log(first === providers.getPetSearchProviders() ? "cached" : "recreated");
`)).toBe("factories-imported\ncached");
  });
});
