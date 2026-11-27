import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {buildCardMetadataRequest, generationCardProvider} from "./card-provider";

const {request} = vi.hoisted(() => ({request: vi.fn()}));
vi.mock("@/lib/openai-ams", () => ({createAMSOpenAIJSONTransport: () => request}));

let directory: string;
beforeEach(async () => {
  request.mockReset();
  directory = await mkdtemp(join(tmpdir(), "pet-card-provider-"));
  const keyFile = join(directory, "synthetic");
  await writeFile(keyFile, "synthetic-key");
  vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE", keyFile);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
});

const input = buildCardMetadataRequest({
  prompt: "private synthetic prompt", displayName: "Synthetic pet",
}, Array(4).fill("data:image/png;base64,YQ=="));

it("records a proxy rejection as unsent without claiming an OpenAI HTTP failure", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  request.mockRejectedValueOnce(new Error("openai_ams_proxy_rejected"));
  await expect(generationCardProvider.generate(input)).rejects.toMatchObject({code: "metadata_unavailable"});
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({phase: "transport", reason: "openai_ams_proxy_rejected"});
  expect(JSON.parse(log.mock.calls[0][0])).not.toHaveProperty("httpStatus");
});

it("retains an ambiguous OpenAI HTTP failure for accounting", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  request.mockRejectedValueOnce(new Error("openai_ams_http_503"));
  await expect(generationCardProvider.generate(input)).rejects.toMatchObject({code: "outcome_unknown"});
  expect(log.mock.calls).toHaveLength(1);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({phase: "transport", reason: "provider_http_error", httpStatus: 503});
});

it("reports an incomplete response without logging its content", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  request.mockResolvedValueOnce({
    model: "gpt-6.1-sol", id: "private-response-id", status: "incomplete",
    incomplete_details: {reason: "max_output_tokens"},
    usage: {input_tokens: 50, output_tokens: 4096, total_tokens: 4146},
    output: [{type: "message", role: "assistant", status: "incomplete", content: [{type: "output_text", text: "private text"}]}],
  });
  await expect(generationCardProvider.generate(input)).rejects.toMatchObject({code: "outcome_unknown"});
  expect(log.mock.calls).toHaveLength(1);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
    phase: "response", reason: "metadata_response_invalid", responseStatus: "incomplete", incompleteReason: "max_output_tokens",
  });
  expect(log.mock.calls[0][0]).not.toMatch(/private|response-id/);
});

it("replaces unrecognized transport errors with a fixed diagnostic", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  request.mockRejectedValueOnce(new Error("private proxy details"));
  await expect(generationCardProvider.generate(input)).rejects.toMatchObject({code: "outcome_unknown"});
  expect(log.mock.calls).toHaveLength(1);
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({phase: "transport", reason: "transport_error"});
  expect(log.mock.calls[0][0]).not.toContain("private proxy details");
});
